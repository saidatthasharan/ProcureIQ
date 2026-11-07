/**
 * Turns uploaded file bytes into addressable text units.
 *
 * Every unit has a locator the model is told to cite (Sheet!Cell, page number,
 * paragraph number, email line number). After extraction, evidence.ts looks the
 * cited location up here and checks the quoted text is really there.
 *
 * Excel, Word, PDF and email are parsed deterministically. Photos cannot be
 * machine-checked and go to the model as pixels.
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { simpleParser } from 'mailparser';
import { extractText, getDocumentProxy } from 'unpdf';

export type DocFormat = 'xlsx' | 'pdf' | 'docx' | 'image' | 'eml';

export interface TextUnit {
  /** Machine-readable address: "Sheet1!E9", "p3", "P14", "L22". */
  id: string;
  kind: 'xlsx_cell' | 'pdf_text' | 'docx_paragraph' | 'email_line';
  page: number | null;
  /** For xlsx: row number, used to group cells of the same row. */
  row?: number;
  sheet?: string;
  text: string;
  /** Docx only: true when the paragraph is inside a table. */
  inTable?: boolean;
}

export interface ParsedDocument {
  format: DocFormat;
  name: string;
  units: TextUnit[];
  /** Text sent to the model for text-based formats. Empty for images. */
  promptText: string;
  /** Present for images and PDFs so the model can also see the original. */
  binary?: { mimeType: string; base64: string };
  /** Facts about the parse, shown in the audit trail. */
  notes: string[];
}

export class UnsupportedFileError extends Error {}

const MAX_BYTES = 15 * 1024 * 1024;

export function detectFormat(fileName: string, mimeType: string, bytes: Buffer): DocFormat {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const isZip = bytes.subarray(0, 2).toString() === 'PK';
  if (bytes.subarray(0, 5).toString() === '%PDF-') return 'pdf';
  if (isZip && ext === 'xlsx') return 'xlsx';
  if (isZip && ext === 'docx') return 'docx';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image';
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image';
  if (ext === 'eml' || mimeType === 'message/rfc822') return 'eml';
  throw new UnsupportedFileError(
    `Unsupported file "${fileName}". Supported: .xlsx, .docx, .pdf, .eml, and JPEG/PNG/WebP images (.xls and .doc are not supported; save as .xlsx / .docx).`
  );
}

export function imageMime(bytes: Buffer): string {
  if (bytes[0] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89) return 'image/png';
  return 'image/webp';
}

/* ---------------------------------------------------------------- xlsx */

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o && o.result != null) return String(o.result);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o) return String(o.text);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return '';
  }
  return String(v);
}

async function parseXlsx(bytes: Buffer): Promise<{ units: TextUnit[]; promptText: string; notes: string[] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  const units: TextUnit[] = [];
  const out: string[] = [];
  const notes: string[] = [];
  wb.eachSheet((ws) => {
    out.push(`=== SHEET "${ws.name}" ===`);
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const parts: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = cellText(cell.value).trim();
        if (!t) return;
        const addr = `${ws.name}!${cell.address}`;
        units.push({ id: addr, kind: 'xlsx_cell', page: null, row: rowNumber, sheet: ws.name, text: t });
        parts.push(`[${cell.address}]=${t}`);
      });
      if (parts.length) out.push(`row ${rowNumber}: ${parts.join(' | ')}`);
    });
    if (ws.state && ws.state !== 'visible') notes.push(`Sheet "${ws.name}" is ${ws.state}.`);
  });
  notes.push(`${wb.worksheets.length} sheet(s) read.`);
  return { units, promptText: out.join('\n'), notes };
}

/* ---------------------------------------------------------------- docx */

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

async function parseDocx(bytes: Buffer): Promise<{ units: TextUnit[]; promptText: string; notes: string[] }> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new UnsupportedFileError('This .docx has no word/document.xml and cannot be read.');
  const xml = await entry.async('string');
  const units: TextUnit[] = [];
  const out: string[] = [];
  // Walk paragraphs in document order and note whether we are inside a table.
  const re = /<w:tbl>|<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let depth = 0;
  let n = 0;
  for (const m of xml.matchAll(re)) {
    const tok = m[0];
    if (tok === '<w:tbl>') { depth++; continue; }
    if (tok === '</w:tbl>') { depth = Math.max(0, depth - 1); continue; }
    const text = decode(
      [...tok.matchAll(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((t) => (t[1] !== undefined ? t[1] : ' ')).join('')
    ).trim();
    if (!text) continue;
    n++;
    units.push({ id: `P${n}`, kind: 'docx_paragraph', page: null, text, inTable: depth > 0 });
    out.push(`[P${n}]${depth > 0 ? '[table]' : ''} ${text}`);
  }
  return { units, promptText: out.join('\n'), notes: [`${n} non-empty paragraph(s) read; tables are flattened one cell per paragraph.`] };
}

/* ----------------------------------------------------------------- pdf */

async function parsePdf(bytes: Buffer): Promise<{ units: TextUnit[]; promptText: string; notes: string[] }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const units: TextUnit[] = [];
  const out: string[] = [];
  const notes: string[] = [`${totalPages} page(s).`];
  pages.forEach((t, i) => {
    const p = i + 1;
    const clean = t.replace(/[ \t]+/g, ' ').trim();
    units.push({ id: `p${p}`, kind: 'pdf_text', page: p, text: clean });
    out.push(`=== PAGE ${p} ===\n${clean}`);
  });
  if (pages.every((t) => t.trim().length < 20)) {
    notes.push('The PDF has almost no extractable text; it may be a scan. Only the model\'s reading of the page images is available and it cannot be machine-checked.');
  }
  return { units, promptText: out.join('\n'), notes };
}

/* ----------------------------------------------------------------- eml */

async function parseEml(bytes: Buffer): Promise<{ units: TextUnit[]; promptText: string; notes: string[] }> {
  const mail = await simpleParser(bytes);
  const lines: string[] = [];
  // Use the raw header lines so evidence is checked against what is literally in the email.
  const wanted = new Set(['from', 'to', 'cc', 'subject', 'date']);
  for (const h of mail.headerLines ?? []) {
    if (wanted.has(h.key)) lines.push(h.line.replace(/\r?\n\s+/g, ' ').trim());
  }
  lines.push('');
  const body = (mail.text ?? '').replace(/\r\n/g, '\n').split('\n');
  lines.push(...body);
  const units: TextUnit[] = [];
  const out: string[] = [];
  lines.forEach((t, i) => {
    const n = i + 1;
    if (t.trim()) units.push({ id: `L${n}`, kind: 'email_line', page: null, text: t.trim() });
    out.push(`[L${n}] ${t}`);
  });
  const notes = [`${lines.length} line(s) including headers.`];
  if (mail.attachments?.length) notes.push(`${mail.attachments.length} attachment(s) present and NOT read: ${mail.attachments.map((a) => a.filename ?? 'unnamed').join(', ')}.`);
  return { units, promptText: out.join('\n'), notes };
}

/* ------------------------------------------------------------- entry */

export async function parseDocument(fileName: string, mimeType: string, bytes: Buffer): Promise<ParsedDocument> {
  if (bytes.length === 0) throw new UnsupportedFileError('The file is empty.');
  if (bytes.length > MAX_BYTES) throw new UnsupportedFileError(`The file is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  const format = detectFormat(fileName, mimeType, bytes);
  switch (format) {
    case 'xlsx': return { format, name: fileName, ...(await parseXlsx(bytes)) };
    case 'docx': return { format, name: fileName, ...(await parseDocx(bytes)) };
    case 'eml': return { format, name: fileName, ...(await parseEml(bytes)) };
    case 'pdf': {
      const p = await parsePdf(bytes);
      return { format, name: fileName, ...p, binary: { mimeType: 'application/pdf', base64: bytes.toString('base64') } };
    }
    case 'image':
      return { format, name: fileName, units: [], promptText: '', binary: { mimeType: imageMime(bytes), base64: bytes.toString('base64') }, notes: ['Image sent to the model as pixels. Values cannot be machine-verified against the source.'] };
  }
}
