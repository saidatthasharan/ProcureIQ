/**
 * Evidence verification.
 *
 * The model says "this price came from Sheet!E9, text: ...". This file looks
 * at the real parsed document and checks that the text is at that location,
 * and that the price number itself appears in the cited text. A model that
 * misreads, misattributes, or invents a citation fails here, and the value is
 * downgraded and sent to the exception queue.
 *
 * Photos cannot be checked this way. They are marked 'visual_unverified' and
 * can never become 'system_validated'.
 */
import type { CheckedEvidence, Evidence, EvidenceCheck, VendorExtractionRaw } from '../src/extraction/schema';
import type { ParsedDocument, TextUnit } from './parsers';

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[​ ]/g, ' ')
    .replace(/₹/g, 'rs')
    .replace(/(\d),(?=\d)/g, '$1') // 1,234.50 -> 1234.50
    .replace(/[^a-z0-9.%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function numbersIn(text: string): number[] {
  const out: number[] = [];
  for (const m of text.replace(/(\d),(?=\d)/g, '$1').matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  return out;
}

function fragmentsPresent(region: string, snippet: string): boolean {
  const R = norm(region);
  // Allow "..." in a snippet: every fragment must appear.
  const frags = snippet.split(/\.{3}|…/).map(norm).filter((f) => f.length >= 3);
  if (frags.length === 0) return false;
  return frags.every((f) => R.includes(f));
}

/** Returns the units a locator points at, or null if the locator cannot be understood. */
export function resolveRegion(doc: ParsedDocument, ev: Evidence): TextUnit[] | null {
  const loc = ev.locator.trim();
  switch (doc.format) {
    case 'xlsx': {
      const refs = [...loc.matchAll(/(?:'?([^'!,;]+?)'?!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+))?/g)];
      if (!refs.length) return null;
      const hit = new Map<string, TextUnit>();
      for (const r of refs) {
        const sheet = r[1]?.trim();
        const r1 = Number(r[3]);
        const r2 = r[5] ? Number(r[5]) : r1;
        for (const u of doc.units) {
          if (u.row == null) continue;
          if (sheet && u.sheet?.toLowerCase() !== sheet.toLowerCase()) continue;
          if (u.row >= Math.min(r1, r2) && u.row <= Math.max(r1, r2)) hit.set(u.id, u);
        }
      }
      return [...hit.values()];
    }
    case 'pdf': {
      const m = loc.match(/(?:p|page)\s*\.?\s*(\d+)/i);
      const page = ev.page ?? (m ? Number(m[1]) : null);
      if (page == null) return null;
      return doc.units.filter((u) => u.page === page);
    }
    case 'docx': {
      const nums = [...loc.matchAll(/(?:para(?:graph)?\.?|p)\s*(\d+)(?:\s*[-–to]+\s*(?:para(?:graph)?\.?|p)?\s*(\d+))?/gi)];
      if (!nums.length) return null;
      const hit = new Map<string, TextUnit>();
      for (const m of nums) {
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : a;
        for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
          const u = doc.units.find((x) => x.id === `P${n}`);
          if (u) hit.set(u.id, u);
        }
      }
      return [...hit.values()];
    }
    case 'eml': {
      const nums = [...loc.matchAll(/(?:line|l)\s*\.?\s*(\d+)(?:\s*[-–to]+\s*(?:line|l)?\s*(\d+))?/gi)];
      if (!nums.length) return null;
      const hit = new Map<string, TextUnit>();
      for (const m of nums) {
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : a;
        for (let n = Math.min(a, b); n <= Math.max(a, b); n++) {
          const u = doc.units.find((x) => x.id === `L${n}`);
          if (u) hit.set(u.id, u);
        }
      }
      return [...hit.values()];
    }
    default:
      return null;
  }
}

function isScanLike(doc: ParsedDocument): boolean {
  return doc.format === 'pdf' && doc.units.every((u) => u.text.length < 20);
}

export function checkEvidence(doc: ParsedDocument, ev: Evidence): { check: EvidenceCheck; regionText: string } {
  if (doc.format === 'image' || isScanLike(doc)) return { check: 'visual_unverified', regionText: '' };
  const region = resolveRegion(doc, ev);
  if (!region || region.length === 0) return { check: 'not_found_in_source', regionText: '' };
  const text = region.map((u) => u.text).join(' ');
  return { check: fragmentsPresent(text, ev.snippet) ? 'verified_in_source' : 'not_found_in_source', regionText: text };
}

const KIND_FOR: Record<ParsedDocument['format'], Evidence['kind']> = {
  xlsx: 'xlsx_cell', pdf: 'pdf_text', docx: 'docx_paragraph', eml: 'email_line', image: 'image_region',
};

/** Do not trust the model for document name or kind. */
export function canonicalise(doc: ParsedDocument, ev: Evidence): Evidence {
  return { ...ev, documentName: doc.name, kind: KIND_FOR[doc.format] };
}

export interface EvidenceReport {
  raw: VendorExtractionRaw;
  lineEvidenceChecks: EvidenceCheck[][];
  validationIssues: string[];
}

export function verifyExtraction(doc: ParsedDocument, raw: VendorExtractionRaw): EvidenceReport {
  const issues: string[] = [];
  const lineChecks: EvidenceCheck[][] = [];

  const fixed: VendorExtractionRaw = JSON.parse(JSON.stringify(raw));
  const fixEv = (list: Evidence[]) => list.map((e) => canonicalise(doc, e));

  // Terms
  const t = fixed.terms;
  for (const k of ['vendorName', 'contactPerson', 'contactEmail', 'paymentTerms', 'validity', 'deliveryLeadTimeDays', 'freight', 'tax'] as const) {
    const x = t[k];
    if (x) x.evidence = fixEv(x.evidence);
  }
  t.discounts.forEach((d) => (d.evidence = fixEv(d.evidence)));
  t.otherTerms.forEach((o) => (o.evidence = fixEv(o.evidence)));
  const termEv: [string, Evidence[] | undefined][] = [
    ['vendorName', t.vendorName?.evidence], ['contactPerson', t.contactPerson?.evidence], ['contactEmail', t.contactEmail?.evidence],
    ['paymentTerms', t.paymentTerms?.evidence], ['validity', t.validity?.evidence], ['deliveryLeadTime', t.deliveryLeadTimeDays?.evidence],
    ['freight', t.freight?.evidence], ['tax', t.tax?.evidence],
  ];
  for (const [name, list] of termEv) {
    if (!list) continue;
    const checked = list.map((e) => checkEvidence(doc, canonicalise(doc, e)).check);
    if (checked.every((c) => c === 'not_found_in_source')) issues.push(`Term "${name}": cited text was not found at the cited location.`);
  }
  t.discounts.forEach((d, i) => {
    const checked = d.evidence.map((e) => checkEvidence(doc, canonicalise(doc, e)).check);
    if (checked.every((c) => c === 'not_found_in_source')) issues.push(`Discount #${i + 1}: cited text was not found at the cited location.`);
  });

  // Lines
  fixed.lines.forEach((line, idx) => {
    line.evidence = fixEv(line.evidence);
    const results = line.evidence.map((e) => checkEvidence(doc, e));
    let checks = results.map((r) => r.check);

    // The price number must appear in the cited text of at least one piece of evidence.
    if (line.unitPrice != null && checks.some((c) => c === 'verified_in_source')) {
      const nums = results.flatMap((r) => numbersIn(r.regionText));
      const found = nums.some((n) => Math.abs(n - (line.unitPrice as number)) < 1e-6);
      if (!found) {
        checks = checks.map(() => 'not_found_in_source' as EvidenceCheck);
        issues.push(`Line ${idx + 1} (${line.rfxItemId ?? line.vendorItemRef ?? 'unmatched'}): the price ${line.unitPrice} does not appear in the cited source text.`);
      }
    }
    if (checks.every((c) => c === 'not_found_in_source')) {
      issues.push(`Line ${idx + 1} (${line.rfxItemId ?? line.vendorItemRef ?? 'unmatched'}): cited evidence could not be found in the document.`);
    }
    lineChecks.push(checks);
  });

  return { raw: fixed, lineEvidenceChecks: lineChecks, validationIssues: [...new Set(issues)] };
}

export type { CheckedEvidence };
