/**
 * Real files in, real parsers, real evidence checks. No model involved.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, UnsupportedFileError } from '../server/parsers';
import { checkEvidence, verifyExtraction, numbersIn } from '../server/evidence';
import type { VendorExtractionRaw } from '../src/extraction/schema';

const DIR = path.resolve(import.meta.dirname, '..', 'public', 'sample-vendor-files');
const truth = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures', 'ground-truth.json'), 'utf8'));
const load = async (vendor: string) => {
  const name = truth.vendors[vendor].file as string;
  return parseDocument(name, '', fs.readFileSync(path.join(DIR, name)));
};
const ev = (locator: string, snippet: string, page: number | null = null) => ({ documentName: 'x', kind: 'xlsx_cell' as const, locator, page, snippet, boundingBox: null });

describe('parsers on the real sample files', () => {
  test('xlsx: reads cell addresses and values from the altered template', async () => {
    const d = await load('V-APEX');
    assert.equal(d.format, 'xlsx');
    const e9 = d.units.find((u) => u.id === 'Commercial_Bid_HYD!E9');
    assert.equal(e9?.text, '88.35');
    assert.ok(d.units.some((u) => u.id === 'Commercial_Bid_HYD!F15' && u.text === 'Per 100 Pieces'));
    assert.ok(d.promptText.includes('[E9]=88.35'));
    assert.ok(d.units.some((u) => u.sheet === 'Terms'), 'second sheet is read too');
  });

  test('pdf: 3 pages, and the discount footnote is on page 3', async () => {
    const d = await load('V-GLOBAL');
    assert.equal(d.format, 'pdf');
    assert.equal(d.units.length, 3);
    assert.match(d.units[2].text, /rebate of 4\.5%/);
    assert.doesNotMatch(d.units[1].text, /rebate of 4\.5%/);
    assert.ok(d.binary?.mimeType === 'application/pdf');
  });

  test('docx: paragraphs are numbered, tables are flattened, both conflicting prices are present', async () => {
    const d = await load('V-PRIMEPACK');
    assert.equal(d.format, 'docx');
    assert.ok(d.units.some((u) => u.text.includes('74.76') && !u.inTable));
    assert.ok(d.units.some((u) => u.inTable && u.text.includes('79.50')));
    assert.ok(d.units.some((u) => u.text.includes("'No Quote'")));
    assert.match(d.promptText, /\[P1\]/);
  });

  test('eml: headers and body are numbered lines, historical trap is present', async () => {
    const d = await load('V-ECOWRAP');
    assert.equal(d.format, 'eml');
    assert.ok(d.units.find((u) => u.id === 'L1')?.text.startsWith('From: Meera Krishnan'));
    assert.ok(d.units.some((u) => /same rate as last year/i.test(u.text)));
    assert.ok(d.units.some((u) => u.text.includes('27.20')));
  });

  test('image: no text units, bytes pass through for the model, flagged as unverifiable', async () => {
    const d = await load('V-SOUTHERN');
    assert.equal(d.format, 'image');
    assert.equal(d.units.length, 0);
    assert.equal(d.binary?.mimeType, 'image/jpeg');
    assert.ok(d.binary!.base64.length > 100_000);
    assert.ok(d.notes.some((n) => n.includes('cannot be machine-verified')));
  });

  test('an unsupported file is rejected with a clear message', async () => {
    await assert.rejects(() => parseDocument('notes.txt', 'text/plain', Buffer.from('hello')), UnsupportedFileError);
    await assert.rejects(() => parseDocument('old.xls', 'application/vnd.ms-excel', Buffer.from([0xd0, 0xcf, 0x11, 0xe0])), /Unsupported file/);
  });

  test('an empty file is rejected', async () => {
    await assert.rejects(() => parseDocument('a.pdf', '', Buffer.alloc(0)), /empty/);
  });

  test('a renamed non-zip file is not accepted as xlsx', async () => {
    await assert.rejects(() => parseDocument('fake.xlsx', '', Buffer.from('not really a spreadsheet')), UnsupportedFileError);
  });
});

describe('evidence verification against the real parsed documents', () => {
  test('xlsx: a correct citation is verified', async () => {
    const d = await load('V-APEX');
    assert.equal(checkEvidence(d, ev('Commercial_Bid_HYD!E9', 'CB5-EXP-6040 ... 88.35')).check, 'verified_in_source');
  });
  test('xlsx: a citation of the right row but another cell is still verified (row-level region)', async () => {
    const d = await load('V-APEX');
    assert.equal(checkEvidence(d, ev('Commercial_Bid_HYD!B9', '88.35')).check, 'verified_in_source');
  });
  test('xlsx: a snippet from a different row is NOT verified', async () => {
    const d = await load('V-APEX');
    assert.equal(checkEvidence(d, ev('Commercial_Bid_HYD!E9', '1780')).check, 'not_found_in_source');
  });
  test('xlsx: a wrong sheet name fails', async () => {
    const d = await load('V-APEX');
    assert.equal(checkEvidence(d, ev('Nonexistent!E9', '88.35')).check, 'not_found_in_source');
  });
  test('pdf: footnote is found on page 3 and not on page 2', async () => {
    const d = await load('V-GLOBAL');
    const e = { ...ev('p3', 'volume rebate of 4.5% on total invoiced value', 3), kind: 'pdf_text' as const };
    assert.equal(checkEvidence(d, e).check, 'verified_in_source');
    assert.equal(checkEvidence(d, { ...e, locator: 'p2', page: 2 }).check, 'not_found_in_source');
  });
  test('docx: paragraph citation works, wrong paragraph fails', async () => {
    const d = await load('V-PRIMEPACK');
    const n = d.units.find((u) => u.text.includes('74.76'))!.id.slice(1);
    const e = { ...ev(`P${n}`, 'Rs 74.76 per Box Ex-Works'), kind: 'docx_paragraph' as const };
    assert.equal(checkEvidence(d, e).check, 'verified_in_source');
    assert.equal(checkEvidence(d, { ...e, locator: 'P1' }).check, 'not_found_in_source');
  });
  test('eml: line citation works', async () => {
    const d = await load('V-ECOWRAP');
    const u = d.units.find((x) => /same rate as last year/i.test(x.text))!;
    const e = { ...ev(`line ${u.id.slice(1)}`, 'same rate as last year'), kind: 'email_line' as const };
    assert.equal(checkEvidence(d, e).check, 'verified_in_source');
  });
  test('image evidence is never verified, only flagged as visual', async () => {
    const d = await load('V-SOUTHERN');
    assert.equal(checkEvidence(d, { ...ev('row 4', '50.04'), kind: 'image_region' }).check, 'visual_unverified');
  });
  test('numbersIn handles Indian grouping', () => {
    assert.deepEqual(numbersIn('Rs 8,500 per pallet; Rs 25,00,000'), [8500, 2500000]);
  });
});

describe('verifyExtraction: line-level price check', () => {
  const mkRaw = (price: number, locator: string, snippet: string): VendorExtractionRaw => ({
    terms: { vendorName: null, contactPerson: null, contactEmail: null, paymentTerms: null, validity: null, deliveryLeadTimeDays: null, freight: null, tax: null, documentCurrency: 'INR', discounts: [], otherTerms: [] },
    lines: [{
      vendorItemRef: '1', rfxItemId: 'PKG-HYD-001', description: null, status: 'quoted', unitPrice: price, currency: 'INR', priceUnit: 'Box', quantity: null,
      taxBasis: 'unspecified', freightNote: null, notes: null, confidence: 0.9, evidence: [ev(locator, snippet)],
    }],
    missingInformation: [], reviewFlags: [],
  });

  test('correct price + correct citation -> verified', async () => {
    const d = await load('V-APEX');
    const r = verifyExtraction(d, mkRaw(88.35, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040'));
    assert.deepEqual(r.lineEvidenceChecks[0], ['verified_in_source']);
    assert.equal(r.validationIssues.length, 0);
  });
  test('right snippet but a MISREAD price (88.53 vs 88.35) is caught', async () => {
    const d = await load('V-APEX');
    const r = verifyExtraction(d, mkRaw(88.53, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040'));
    assert.deepEqual(r.lineEvidenceChecks[0], ['not_found_in_source']);
    assert.ok(r.validationIssues.some((i) => i.includes('88.53')));
  });
  test('fabricated citation is caught', async () => {
    const d = await load('V-APEX');
    const r = verifyExtraction(d, mkRaw(88.35, 'Commercial_Bid_HYD!E9', 'totally invented text'));
    assert.deepEqual(r.lineEvidenceChecks[0], ['not_found_in_source']);
  });
  test('document name and kind are set by the server, not trusted from the model', async () => {
    const d = await load('V-APEX');
    const r = verifyExtraction(d, mkRaw(88.35, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040'));
    assert.equal(r.raw.lines[0].evidence[0].documentName, d.name);
    assert.equal(r.raw.lines[0].evidence[0].kind, 'xlsx_cell');
  });
});
