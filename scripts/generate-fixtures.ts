/**
 * Generates the five synthetic vendor documents for the Hyderabad Packaging RFQ,
 * and a ground-truth file that is used ONLY by tests and evals.
 *
 *   npx tsx scripts/generate-fixtures.ts
 *
 * The documents are written to public/sample-vendor-files/ so they can be
 * uploaded through the app. The ground truth is written to
 * tests/fixtures/ground-truth.json and is never imported by application code.
 *
 * All vendors, prices and terms are fictional and synthetic.
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType,
} from 'docx';
import { INITIAL_LINE_ITEMS as ITEMS } from '../src/data/seedData';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'sample-vendor-files');
const TRUTH = path.join(ROOT, 'tests', 'fixtures', 'ground-truth.json');
const FX = 83.5; // reference USD/INR used only to compute expected values in the ground truth

const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const idOf = (n: number) => `PKG-HYD-${String(n).padStart(3, '0')}`;
const item = (n: number) => ITEMS[n - 1];

/* Price shape per vendor: a multiplier on the RFx baseline. Fixture authoring input only. */
const APEX = [0.93, 0.91, 0.94, 0.92, 0.95, 0.91, 0.913, 0.9, 0.94, 0.92, 0.91, 0.92, 0.95, 0.96, 0.94, 0.95, 0.93, 0.94, 0.93, 0.92, 0.915, 0.93, 0.91, 0.92, 0.93, 0.95, 0.94, 0.95, 0.92, 0.93];
const GLOBAL = [0.955, 0.96, 0.95, 0.95, 0.96, 0.95, 0.96, 0.95, 0.95, 0.96, 0.96, 0.95, 0.94, 0.93, 0.97, 0.96, 0.95, 0.95, 0.96, 0.96, 0.96, 0.94, 0.95, 0.94, 0.95, 0.97, 0.96, 0.94, 0.94, 0.93];
const PRIME = [0.93, 0.92, 0.93, 0.91, 0.94, 0.93, 0.89, 0.88, 0.89, 0.88, 0.9, 0.89, 0.91, 0.94, 0.92, 0.93, 0.9, 0.91, 0.92, 0.9, 0.93, 0.91, 0.92, 0.91, 0.89, 0.93, 0, 0, 0.89, 0];
const SOUTH = [0.86, 0.85, 0.88, 0.84, 0.89, 0.86, 0.85, 0.84, 0.86, 0.85, 0.85, 0.86, 0.88, 0.91, 0.83, 0.89, 0.84, 0.88, 0.85, 0.84, 0.87, 0.86, 0.84, 0.86, 0.85, 0.87, 0.86, 0.89, 0.85, 0.86];
const ECO = [0.94, 0.93, 0.95, 0.93, 0.94, 0.94, 0.9, 0.89, 0.922, 0.896, 0.92, 0.93, 0.9, 0.95, 0.87, 0.86, 0.86, 0.915, 0.872, 0.867, 0.88, 0.92, 0, 0, 0, 0.88, 0.87, 0.88, 0, 0];
const base = (n: number, f: number[]) => r2(item(n).baselineUnitPriceInr * f[n - 1]);

/* ------------------------------------------------------------- ground truth */
interface TruthLine {
  status: 'quoted' | 'not_quoted' | 'historical_reference';
  written: { price: number | null; currency: 'INR' | 'USD' | null; unit: string | null } | null;
  expectedNormalisedInr: number | null;
  note?: string;
  /** A price present in the document that must NOT be used (e.g. last year's rate). */
  trapPriceInDocument?: number;
}
const truth: Record<string, { file: string; format: string; terms: Record<string, unknown>; items: Record<string, TruthLine> }> = {};

/* ================================================================== APEX xlsx */
async function apex() {
  const file = 'Apex_HydPlant_Quotation_2026_ModifiedCols.xlsx';
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Commercial_Bid_HYD');
  ws.getCell('A1').value = 'APEX PACKAGING INDUSTRIES';
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A2').value = 'Medchal Industrial Park, Hyderabad';
  ws.getCell('A3').value = 'Quotation against RFQ-AER-HYD-2026-089 | Contact: Rajeshwar Reddy | r.reddy@apexpackaging.in';
  ws.getCell('A4').value = 'Validity: 30 days from 03-Nov-2026 | Payment: Net 45 Days | Delivery: 12 days from PO';
  ws.getCell('A5').value = 'All rates are DDP Pashamylaram plant, freight included. GST @18% extra as applicable.';
  const headers = ['Sr', 'Material Code (as per RFQ)', 'Item Description', 'Qty (Nos)', 'Our Rate (Rs.)', 'Rate Basis', 'Remarks'];
  headers.forEach((h, i) => {
    const c = ws.getRow(8).getCell(i + 1);
    c.value = h;
    c.font = { bold: true };
  });
  [6, 26, 62, 12, 16, 18, 34].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const t: Record<string, TruthLine> = {};
  for (let n = 1; n <= 30; n++) {
    const it = item(n);
    const std = base(n, APEX);
    let price = std, basis = 'Per Box', remark = 'DDP';
    if (n === 7 || n === 8) { price = r2(std * 100); basis = 'Per 100 Pieces'; remark = 'Rate per 100 pcs'; }
    if (n === 21) { price = r2(std * 1000); basis = 'Per Metric Tonne'; remark = 'Rate per MT'; }
    else if (n !== 7 && n !== 8) basis = `Per ${it.standardUom}`;
    const row = ws.getRow(8 + n);
    [n, it.code, it.description, it.quantity, price, basis, remark].forEach((v, i) => (row.getCell(i + 1).value = v));
    t[idOf(n)] = { status: 'quoted', written: { price, currency: 'INR', unit: basis.replace('Per ', '') }, expectedNormalisedInr: std };
  }
  const terms = wb.addWorksheet('Terms');
  terms.getCell('A1').value = 'Commercial terms';
  terms.getCell('A2').value = 'Warranty: manufacturing defects only. Prices firm for 30 days.';
  await wb.xlsx.writeFile(path.join(OUT, file));
  truth['V-APEX'] = { file, format: 'xlsx', items: t, terms: { payment: 'Net 45 Days', leadTimeDays: 12, freight: 'included (DDP)', gst: 'extra 18%', discount: null } };
}

/* ================================================================== GLOBAL pdf */
async function global() {
  const file = 'GlobalCorrugators_CommercialBid_HYD2026.pdf';
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(fs.createWriteStream(path.join(OUT, file)));
  doc.font('Helvetica-Bold').fontSize(16).text('GLOBAL CORRUGATORS LTD.');
  doc.font('Helvetica').fontSize(10).text('Sri City SEZ / Jeedimetla Hub').moveDown();
  doc.fontSize(11).text('Commercial Bid - Hyderabad Packaging 2026 (Ref: RFQ-AER-HYD-2026-089)');
  doc.text('Submitted by: Suresh Menon, smenon@globalcorrugators.com').moveDown();
  doc.text('Payment terms: Net 45 Days');
  doc.text('Delivery: 14 days from receipt of purchase order');
  doc.text('Freight: Delivered, included in the rates (DDP Hyderabad plant)');
  doc.text('Taxes: GST at 18% is extra on all rates');
  doc.text('Rates are Gross rates; see page 3 note marked with an asterisk.').moveDown();
  doc.fontSize(9).fillColor('#666').text('Rates in the following tables are per unit as stated in the UOM column. Currency is stated per line.').fillColor('#000');

  const t: Record<string, TruthLine> = {};
  const cols = [30, 90, 215, 45, 55, 70];
  const heads = ['Sl', 'Item Code', 'Description', 'UOM', 'Curr.', 'Gross Rate*'];
  const drawHeader = (y: number) => {
    let x = 40;
    doc.font('Helvetica-Bold').fontSize(9);
    heads.forEach((h, i) => { doc.text(h, x, y, { width: cols[i] }); x += cols[i]; });
    doc.font('Helvetica');
  };
  const draw = (from: number, to: number) => {
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).text(`Table 1 - Price schedule (lines ${from} to ${to})`, 40, 40);
    drawHeader(70);
    let y = 90;
    for (let n = from; n <= to; n++) {
      const it = item(n);
      const gross = base(n, GLOBAL);
      const usd = n <= 5;
      const written = usd ? Math.round((gross / FX) * 1000) / 1000 : gross;
      let x = 40;
      doc.font('Helvetica').fontSize(8.5);
      [String(n), it.code, it.description, it.standardUom, usd ? 'USD' : 'INR', written.toFixed(usd ? 3 : 2)].forEach((v, i) => {
        doc.text(v, x, y, { width: cols[i] - 4, height: 20, ellipsis: true, lineBreak: i === 2 });
        x += cols[i];
      });
      y += 30;
      const expected = r2((usd ? written * FX : written) * (1 - 0.045));
      t[idOf(n)] = { status: 'quoted', written: { price: written, currency: usd ? 'USD' : 'INR', unit: it.standardUom }, expectedNormalisedInr: expected, note: 'Conditional 4.5% rebate (page 3 footnote) applied in expected value' };
    }
  };
  draw(1, 15);
  draw(16, 30);
  doc.font('Helvetica').fontSize(7).fillColor('#444').text(
    '* Gross rates are quoted before rebate. A volume rebate of 4.5% on total invoiced value applies if the total awarded value exceeds Rs 25,00,000.',
    40, 760, { width: 515 }
  );
  doc.end();
  await new Promise((r) => setTimeout(r, 400));
  truth['V-GLOBAL'] = { file, format: 'pdf', items: t, terms: { payment: 'Net 45 Days', leadTimeDays: 14, freight: 'included (DDP)', gst: 'extra 18%', discount: { percent: 4.5, minAwardValueInr: 2500000, location: 'page 3 footnote' } } };
}

/* ================================================================== PRIMEPACK docx */
async function prime() {
  const file = 'PrimePack_Proposal_Narrative_2026.docx';
  const t: Record<string, TruthLine> = {};
  const P = (text: string, opts: { bold?: boolean } = {}) => new Paragraph({ children: [new TextRun({ text, bold: opts.bold })], spacing: { after: 120 } });
  const H = (text: string) => new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
  const body: (Paragraph | Table)[] = [];
  body.push(new Paragraph({ text: 'PrimePack Solutions - Commercial Proposal', heading: HeadingLevel.TITLE }));
  body.push(P('Balanagar Industrial Area, Hyderabad. Contact: Karthikeya Sharma, k.sharma@primepacksolutions.co.in'));
  body.push(H('1. Executive Summary'));
  body.push(P('PrimePack Solutions is pleased to respond to RFQ-AER-HYD-2026-089. Our offer covers most of the requested range. Highlights: delivery within 15 days of purchase order, payment terms Net 45 Days, and rates quoted Ex-Works Balanagar.'));
  body.push(P('For the Full Overlap Slotted Container for heavy castings (PKG-HYD-012) we are able to offer Rs 74.76 per Box Ex-Works Balanagar, reflecting our current board purchase contracts.'));
  body.push(H('2. Commercial Conditions'));
  body.push(P('All rates in this proposal are Ex-Works Balanagar. Freight to the Pashamylaram plant is charged extra at 3.5% of the order value. GST at 18% is extra and not included in any rate. Prices are valid for 30 days.'));
  body.push(H('3. Pricing by Product Family'));
  const sentence = (n: number) => {
    const it = item(n);
    const p = base(n, PRIME);
    t[idOf(n)] = { status: 'quoted', written: { price: p, currency: 'INR', unit: it.standardUom }, expectedNormalisedInr: r2(p * 1.035) };
    return `For ${it.description} (${it.code}), our commercial offer is Rs ${inr(p)} per ${it.standardUom} Ex-Works Balanagar.`;
  };
  body.push(P('3.1 Five-ply corrugated boxes', { bold: true }));
  for (let n = 1; n <= 6; n++) body.push(P(sentence(n)));
  body.push(P('3.2 Three-ply boxes', { bold: true }));
  const grouped = [7, 8, 9, 10];
  grouped.forEach((n) => sentence(n));
  body.push(P(`For our three-ply range we offer: ${grouped.map((n) => `${item(n).code} at Rs ${inr(base(n, PRIME))} per Box`).join('; ')}. All Ex-Works Balanagar.`));
  body.push(P('3.3 Shipping cartons and protective packaging', { bold: true }));
  // Item 012 deliberately omitted here (appears in exec summary and Schedule B with different prices).
  for (const n of [11, 13, 14]) body.push(P(sentence(n)));
  body.push(P('Pricing for items PKG-HYD-012, 015, 016, 017 and 018 is set out in Schedule B at the end of this document.'));
  body.push(P('3.4 Sheets, custom cartons, rolls and inserts', { bold: true }));
  for (const n of [19, 20, 21, 22, 23, 24, 25, 26, 29]) body.push(P(sentence(n)));
  body.push(P("Note: PrimePack regrets to offer 'No Quote' on the narrow 900mm wrapping rolls (PKG-HYD-027), the VCI corrosion-inhibitor rolls (PKG-HYD-028), and the 24-cell E-flute partition sets (PKG-HYD-030) due to current tooling allocation."));
  for (const n of [27, 28, 30]) t[idOf(n)] = { status: 'not_quoted', written: null, expectedNormalisedInr: null };
  body.push(H('Schedule B - Additional Rates (Ex-Works Balanagar)'));
  const sb: [number, number][] = [[12, 79.5], [15, base(15, PRIME)], [16, base(16, PRIME)], [17, base(17, PRIME)], [18, base(18, PRIME)]];
  const cell = (text: string) => new TableCell({ width: { size: 2000, type: WidthType.DXA }, children: [new Paragraph(text)] });
  body.push(new Table({
    rows: [
      new TableRow({ children: ['Item', 'Code', 'Rate (Rs)', 'UOM'].map(cell) }),
      ...sb.map(([n, p]) => new TableRow({ children: [idOf(n), item(n).code, inr(p), item(n).standardUom].map(cell) })),
    ],
  }));
  for (const [n, p] of sb) {
    if (n === 12) {
      t[idOf(12)] = { status: 'quoted', written: { price: 79.5, currency: 'INR', unit: 'Box' }, expectedNormalisedInr: null, note: 'CONFLICT: executive summary says 74.76, Schedule B says 79.50. Must be flagged, neither used.' };
    } else {
      t[idOf(n)] = { status: 'quoted', written: { price: p, currency: 'INR', unit: item(n).standardUom }, expectedNormalisedInr: r2(p * 1.035) };
    }
  }
  const doc = new Document({ sections: [{ children: body }] });
  fs.writeFileSync(path.join(OUT, file), await Packer.toBuffer(doc));
  truth['V-PRIMEPACK'] = { file, format: 'docx', items: t, terms: { payment: 'Net 45 Days', leadTimeDays: 15, freight: 'extra 3.5% (ex-works)', gst: 'extra 18%', discount: null, conflictItem: 'PKG-HYD-012' } };
}

/* ================================================================== SOUTHERN jpg (angled photo) */
async function southern() {
  const file = 'IMG_20261104_114822_SignedRateCard.jpg';
  const W = 1500, H = 2150, ROW = 55, TOP = 330;
  const t: Record<string, TruthLine> = {};
  const hand = new Set([4, 15, 23]); // printed value struck through, corrected by hand
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let rows = '';
  for (let n = 1; n <= 30; n++) {
    const it = item(n);
    const norm = r2(it.baselineUnitPriceInr * SOUTH[n - 1]);
    const incl = r2((norm / 1.04) * 1.18); // price on the card includes GST; freight is extra
    const y = TOP + n * ROW;
    const shortDesc = it.description.length > 54 ? it.description.slice(0, 51) + '...' : it.description;
    rows += `<text x="60" y="${y}" font-size="23">${n}</text>`;
    rows += `<text x="115" y="${y}" font-size="21">${esc(it.code)}</text>`;
    rows += `<text x="330" y="${y}" font-size="19">${esc(shortDesc)}</text>`;
    rows += `<text x="1140" y="${y}" font-size="20">${esc(it.standardUom)}</text>`;
    if (hand.has(n)) {
      const printed = r2(incl * 1.09);
      rows += `<text x="1230" y="${y}" font-size="23" fill="#555">${inr(printed)}</text>`;
      rows += `<line x1="1225" y1="${y - 8}" x2="1325" y2="${y - 8}" stroke="#222" stroke-width="3"/>`;
      rows += `<text x="1335" y="${y + 4}" font-size="26" font-style="italic" fill="#1a3fb5" transform="rotate(-5 1335 ${y})">${inr(incl)}</text>`;
    } else {
      rows += `<text x="1230" y="${y}" font-size="23">${inr(incl)}</text>`;
    }
    rows += `<line x1="50" y1="${y + 14}" x2="1450" y2="${y + 14}" stroke="#ccc" stroke-width="1"/>`;
    t[idOf(n)] = {
      status: 'quoted', written: { price: incl, currency: 'INR', unit: it.standardUom },
      expectedNormalisedInr: r2((incl / 1.18) * 1.04),
      note: hand.has(n) ? 'Printed value struck through; handwritten correction is the valid price' : undefined,
    };
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="DejaVu Sans, sans-serif">
    <rect width="100%" height="100%" fill="#fbfaf4"/>
    <text x="60" y="80" font-size="40" font-weight="bold">SOUTHERN BOX MANUFACTURING</text>
    <text x="60" y="120" font-size="22">Katedan Industrial Estate, Hyderabad | sales@southernboxmfg.in | Venkatesh Goud</text>
    <text x="60" y="175" font-size="30" font-weight="bold">RATE CARD - HYDERABAD PACKAGING RFQ 2026</text>
    <text x="60" y="215" font-size="21">All rates in Rupees per unit, INCLUSIVE of GST 18%. Freight / tempo charges EXTRA at 4.0%.</text>
    <text x="60" y="248" font-size="21">Payment: Net 30 days.   Delivery: 10 days from PO.</text>
    <rect x="45" y="${TOP - 20}" width="1410" height="2" fill="#000"/>
    <text x="60" y="${TOP - 3}" font-size="19" font-weight="bold">No</text>
    <text x="115" y="${TOP - 3}" font-size="19" font-weight="bold">Item code</text>
    <text x="330" y="${TOP - 3}" font-size="19" font-weight="bold">Description</text>
    <text x="1140" y="${TOP - 3}" font-size="19" font-weight="bold">Unit</text>
    <text x="1230" y="${TOP - 3}" font-size="19" font-weight="bold">Rate (Rs)</text>
    ${rows}
    <text x="60" y="${TOP + 31 * ROW + 20}" font-size="20">Authorised signatory: V. Goud    Date: 04-11-2026</text>
    <ellipse cx="1180" cy="${TOP + 31 * ROW + 5}" rx="130" ry="55" fill="none" stroke="#7a1fa2" stroke-width="4" opacity="0.7" transform="rotate(-8 1180 ${TOP + 31 * ROW})"/>
    <text x="1075" y="${TOP + 31 * ROW + 12}" font-size="22" fill="#7a1fa2" opacity="0.8" transform="rotate(-8 1180 ${TOP + 31 * ROW})">SOUTHERN BOX MFG.</text>
  </svg>`;
  const flat = await sharp(Buffer.from(svg)).png().toBuffer();
  // Simulate a phone photo: shear + rotate on a desk-coloured background, uneven light, blur, noise, JPEG.
  const bg = { r: 92, g: 74, b: 58, alpha: 1 };
  const canvasW = 1800, canvasH = 2500;
  const placed = await sharp(flat)
    .affine([[1, 0.07], [0.02, 1]], { background: bg })
    .rotate(-4.5, { background: bg })
    .resize({ width: 1600 })
    .toBuffer();
  const glare = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}"><defs><radialGradient id="g" cx="68%" cy="30%" r="35%"><stop offset="0%" stop-color="#fff" stop-opacity="0.35"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0.0"/><stop offset="100%" stop-color="#000" stop-opacity="0.28"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#s)"/></svg>`);
  const noise = await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 14 } } }).png().toBuffer();
  await sharp({ create: { width: canvasW, height: canvasH, channels: 3, background: bg } })
    .composite([
      { input: placed, left: 90, top: 120 },
      { input: glare, blend: 'over' },
      { input: noise, blend: 'soft-light' },
    ])
    .blur(0.6)
    .jpeg({ quality: 82 })
    .toFile(path.join(OUT, file));
  truth['V-SOUTHERN'] = { file, format: 'image', items: t, terms: { payment: 'Net 30 days', leadTimeDays: 10, freight: 'extra 4.0%', gst: 'inclusive 18%', discount: null, handwrittenCorrections: [...hand].map(idOf) } };
}

/* ================================================================== ECOWRAP eml */
function eco() {
  const file = 'RE_RFQ_Hyderabad_Corrugated_Packaging_2026.eml';
  const t: Record<string, TruthLine> = {};
  const notQuoted = [3, 14, 22, 23, 24, 25, 29, 30];
  const hist = [9, 10, 18];
  const histOld: Record<number, number> = { 9: 27.2, 10: 21.5, 18: 65.0 };
  const lines: string[] = [];
  const priced: number[] = [];
  for (let n = 1; n <= 30; n++) {
    if (notQuoted.includes(n)) { t[idOf(n)] = { status: 'not_quoted', written: null, expectedNormalisedInr: null }; continue; }
    if (hist.includes(n)) { t[idOf(n)] = { status: 'historical_reference', written: null, expectedNormalisedInr: null, trapPriceInDocument: histOld[n], note: "Email says 'same rate as last year' - no current price" }; continue; }
    if (n === 19) {
      t[idOf(19)] = { status: 'quoted', written: { price: 8500, currency: 'INR', unit: 'strapped pallet load' }, expectedNormalisedInr: null, note: 'Sheets per pallet not stated - unit unresolved, must be blocked' };
      lines.push(`Item 19 (${item(19).code}): Rs 8,500 per strapped pallet load, delivered.`);
      continue;
    }
    const p = base(n, ECO);
    priced.push(n);
    t[idOf(n)] = { status: 'quoted', written: { price: p, currency: 'INR', unit: item(n).standardUom }, expectedNormalisedInr: p };
    lines.push(`${n}. ${item(n).code} - ${item(n).description}: Rs ${inr(p)} per ${item(n).standardUom}`);
  }
  // Keep the email in item order: items 9, 10, 18 get their own sentence below.
  const body = [
    'Hi Team,',
    '',
    'Thank you for the RFQ for Hyderabad corrugated packaging 2026. Please find our partial quotation below.',
    'All our rates are delivered to your Pashamylaram plant, freight included. GST at 18% is extra.',
    'Payment terms: Net 45 Days. Delivery: 14 days from PO. Offer valid until 30 November 2026.',
    '',
    'QUOTED ITEMS',
    ...lines,
    '',
    'Items 09, 10 & 18: please take the same rate as last year, Q3 2025 PO #PO-HYD-25-114. We have not re-priced these for 2026.',
    '',
    'NOT QUOTED THIS CYCLE',
    'We are not quoting items 3, 14, 22, 23, 24, 25, 29 and 30 (drum overpack, UN-4G dangerous goods, telescopic and custom die-cut cartons, kanban bins, and the partition sets) in this cycle.',
    '',
    'We will send our completed supplier questionnaire separately.',
    '',
    'Regards,',
    'Meera Krishnan',
    'EcoWrap Packaging, Patancheru IDA, Hyderabad',
    'meera@ecowrappack.com',
    '',
    '-----Original Message-----',
    'From: Meera Krishnan <meera@ecowrappack.com>',
    'Sent: 14 July 2025',
    'Subject: Q3 2025 PO rates (for reference only)',
    '',
    'Rates billed under PO-HYD-25-114: item 9 at Rs 27.20, item 10 at Rs 21.50, item 18 at Rs 65.00 per box.',
  ];
  const eml = [
    'From: Meera Krishnan <meera@ecowrappack.com>',
    'To: Procurement <procurement@example-buyer.com>',
    'Subject: RE: RFQ Hyderabad Corrugated Packaging 2026 - EcoWrap quotation',
    'Date: Wed, 04 Nov 2026 16:08:00 +0530',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    ...body,
  ].join('\r\n');
  fs.writeFileSync(path.join(OUT, file), eml);
  truth['V-ECOWRAP'] = { file, format: 'eml', items: t, terms: { payment: 'Net 45 Days', leadTimeDays: 14, freight: 'included (delivered)', gst: 'extra 18%', discount: null, counts: { firmPriced: priced.length, unitUnresolved: 1, historicalReference: hist.length, notQuoted: notQuoted.length } } };
}

/* ================================================================== run */
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.dirname(TRUTH), { recursive: true });
await apex();
await global();
await prime();
await southern();
eco();
// Which sample file belongs to which invited supplier. This is NOT ground truth: it only lets the app's
// "Use sample files" button attach each file to the right supplier, like choosing it in the upload dialog.
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(Object.fromEntries(Object.entries(truth).map(([id, v]) => [id, v.file])), null, 2));
fs.writeFileSync(TRUTH, JSON.stringify({ generatedBy: 'scripts/generate-fixtures.ts', fxRateUsed: FX, vendors: truth }, null, 2));
for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(60), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1) + ' KB');
console.log('ground truth ->', path.relative(ROOT, TRUTH));
