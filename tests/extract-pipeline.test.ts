/**
 * PLUMBING TESTS with a stub model. They prove the pipeline wiring (prompting,
 * schema validation, repair retry, evidence downgrade, HTTP errors, key
 * handling). They do NOT prove the AI reads documents correctly; that needs a
 * live key (scripts/eval-live.ts).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { INITIAL_LINE_ITEMS as ITEMS } from '../src/data/seedData';
import { extractVendorDocument, ExtractionError, EXTRACTION_JSON_SCHEMA } from '../server/extract';
import { createApp } from '../server/app';
import { ModelNotConfiguredError, createGeminiClient, type GenerateJsonRequest, type ModelClient } from '../server/model';
import { deriveVendorData } from '../src/extraction/derive';

const FILES = path.resolve(import.meta.dirname, '..', 'public', 'sample-vendor-files');
const APEX = fs.readFileSync(path.join(FILES, 'Apex_HydPlant_Quotation_2026_ModifiedCols.xlsx'));
const rfx = ITEMS.map((i) => ({ id: i.id, code: i.code, description: i.description, standardUom: i.standardUom, quantity: i.quantity }));

const emptyTerms = { vendorName: null, contactPerson: null, contactEmail: null, paymentTerms: null, validity: null, deliveryLeadTimeDays: null, freight: null, tax: null, documentCurrency: 'INR', discounts: [], otherTerms: [] };
const line = (n: number, price: number, locator: string, snippet: string, unit = 'Box') => ({
  vendorItemRef: String(n), rfxItemId: `PKG-HYD-${String(n).padStart(3, '0')}`, description: null, status: 'quoted', unitPrice: price, currency: 'INR', priceUnit: unit,
  quantity: null, taxBasis: 'unspecified', freightNote: null, notes: null, confidence: 0.95,
  evidence: [{ documentName: 'ignored', kind: 'pdf_text', locator, page: null, snippet, boundingBox: null }],
});
const answer = (lines: unknown[]) => JSON.stringify({ terms: emptyTerms, lines, missingInformation: [], reviewFlags: [] });

function stub(responses: string[], seen: GenerateJsonRequest[] = []): ModelClient {
  let i = 0;
  return {
    modelName: 'stub-model',
    async generateJson(req) { seen.push(req); return { text: responses[Math.min(i++, responses.length - 1)], schemaMode: 'json_schema' }; },
    async generateToolTurn() { throw new Error('not used'); },
  };
}
const input = { fileName: 'Apex.xlsx', mimeType: '', bytes: APEX, lineItems: rfx };

describe('extraction pipeline (stub model)', () => {
  test('valid answer -> evidence verified against the real file -> derived cells', async () => {
    const m = stub([answer([
      line(1, 88.35, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040', 'Box'),
      line(7, 1780, 'Commercial_Bid_HYD!E15', 'CB3-STD-3020', '100 Pieces'),
    ])]);
    const { result, repaired } = await extractVendorDocument(input, m);
    assert.equal(repaired, false);
    assert.deepEqual(result.lineEvidenceChecks, [['verified_in_source'], ['verified_in_source']]);
    assert.equal(result.meta.documentFormat, 'xlsx');
    assert.equal(result.meta.model, 'stub-model');
    assert.match(result.meta.sha256, /^[0-9a-f]{64}$/);
    const d = deriveVendorData({ id: 'V-APEX', name: 'Apex Packaging Industries', shortName: 'Apex' }, result, ITEMS);
    const c1 = d.cells.find((c) => c.itemId === 'PKG-HYD-001')!;
    const c7 = d.cells.find((c) => c.itemId === 'PKG-HYD-007')!;
    assert.equal(c1.normalisedUnitPriceInr, 88.35);
    assert.equal(c1.trust, 'system_validated');
    assert.equal(c7.normalisedUnitPriceInr, 17.8); // 1780 per 100 pieces
    assert.equal(c7.buyerVerified, false);
    assert.equal(d.cells.filter((c) => c.blockReasons?.includes('not_mentioned')).length, 28);
  });

  test('prompt carries the RFQ list, the real cell text and the injection warning; schema is passed', async () => {
    const seen: GenerateJsonRequest[] = [];
    await extractVendorDocument(input, stub([answer([line(1, 88.35, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040')])], seen));
    const text = (seen[0].parts[0] as { text: string }).text;
    assert.match(text, /PKG-HYD-001 \| code CB5-EXP-6040/);
    assert.match(text, /\[E9\]=88\.35/);
    assert.match(seen[0].system, /untrusted data/);
    assert.match(seen[0].system, /historical_reference/);
    assert.ok((EXTRACTION_JSON_SCHEMA as { properties: Record<string, unknown> }).properties.lines);
    assert.equal(seen[0].jsonSchema, EXTRACTION_JSON_SCHEMA);
  });

  test('invalid JSON on the first try -> one repair attempt that quotes the problem', async () => {
    const seen: GenerateJsonRequest[] = [];
    const m = stub(['{"terms": {', answer([line(1, 88.35, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040')])], seen);
    const { result, repaired } = await extractVendorDocument(input, m);
    assert.equal(repaired, true);
    assert.equal(seen.length, 2);
    assert.match((seen[1].parts.at(-1) as { text: string }).text, /failed validation/);
    assert.ok(result.validationIssues.some((i) => i.includes('regenerated')));
  });

  test('schema-invalid answer (missing evidence) is rejected, not accepted', async () => {
    const bad = JSON.stringify({ terms: emptyTerms, lines: [{ ...line(1, 88.35, 'x', 'y'), evidence: [] }], missingInformation: [], reviewFlags: [] });
    await assert.rejects(() => extractVendorDocument(input, stub([bad, bad])), (e: unknown) => e instanceof ExtractionError && e.issues.length > 0);
  });

  test('model that never returns valid JSON -> ExtractionError, nothing returned', async () => {
    await assert.rejects(() => extractVendorDocument(input, stub(['nonsense', 'still nonsense'])), ExtractionError);
  });

  test('a MISREAD price is caught by evidence verification and becomes non-comparable', async () => {
    const m = stub([answer([line(1, 88.53, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040')])]);
    const { result } = await extractVendorDocument(input, m);
    assert.deepEqual(result.lineEvidenceChecks[0], ['not_found_in_source']);
    const d = deriveVendorData({ id: 'V-APEX', name: 'Apex Packaging Industries', shortName: 'Apex' }, result, ITEMS);
    const c = d.cells.find((x) => x.itemId === 'PKG-HYD-001')!;
    assert.equal(c.isComparable, false);
    assert.equal(c.normalisedUnitPriceInr, null);
    assert.equal(c.trust, 'ai_extracted');
    assert.ok(d.exceptions.some((e) => e.itemId === 'PKG-HYD-001'));
  });
});

describe('HTTP API', () => {
  let server: Server;
  let base: string;
  const SECRET = 'AIzaSy-test-secret-key-do-not-leak';
  const prevKey = process.env.GEMINI_API_KEY;
  const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = (bytes: Buffer, name: string) => ({ fileName: name, mimeType: '', dataBase64: bytes.toString('base64'), lineItems: rfx });

  before(async () => {
    process.env.GEMINI_API_KEY = SECRET;
    const app = createApp({
      getModel: () => stub([answer([line(1, 88.35, 'Commercial_Bid_HYD!E9', 'CB5-EXP-6040')])]),
      rateLimit: { max: 6, windowMs: 60_000 },
    });
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => {
    server.close();
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevKey;
  });

  test('health reports configuration but never the key', async () => {
    const r = await fetch(base + '/api/health');
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.equal(JSON.parse(text).aiConfigured, true);
    assert.ok(!text.includes(SECRET));
  });

  test('extract returns the result and a source view', async () => {
    const r = await post('/api/extract', body(APEX, 'Apex.xlsx'));
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.result.raw.lines.length, 1);
    assert.ok(j.sourceView.units.some((u: { id: string }) => u.id === 'Commercial_Bid_HYD!E9'));
    assert.ok(!JSON.stringify(j).includes(SECRET));
  });

  test('unsupported file -> 400 with a clear message', async () => {
    const r = await post('/api/extract', body(Buffer.from('hello'), 'notes.txt'));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'UNSUPPORTED_FILE');
  });

  test('malformed request -> 400', async () => {
    const r = await post('/api/extract', { fileName: 'a.xlsx' });
    assert.equal(r.status, 400);
  });

  test('unknown API route -> JSON 404, not the web page', async () => {
    const r = await fetch(base + '/api/nope');
    assert.equal(r.status, 404);
    assert.equal((await r.json()).error, 'NOT_FOUND');
  });

  test('rate limiter returns 429 after the limit', async () => {
    let last = 0;
    for (let i = 0; i < 8; i++) last = (await post('/api/extract', body(Buffer.from('x'), 'a.txt'))).status;
    assert.equal(last, 429);
  });
});

describe('without a key the server refuses honestly', () => {
  const prev = process.env.GEMINI_API_KEY;
  test('createGeminiClient throws ModelNotConfiguredError', () => {
    delete process.env.GEMINI_API_KEY;
    assert.throws(() => createGeminiClient(), ModelNotConfiguredError);
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  });

  test('/api/extract returns 503 GEMINI_KEY_MISSING and produces no data', async () => {
    delete process.env.GEMINI_API_KEY;
    const app = createApp(); // default dependencies = real Gemini client
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const r = await fetch(base + '/api/extract', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'Apex.xlsx', mimeType: '', dataBase64: APEX.toString('base64'), lineItems: rfx }),
      });
      const j = await r.json();
      assert.equal(r.status, 503);
      assert.equal(j.error, 'GEMINI_KEY_MISSING');
      assert.equal(j.result, undefined);
      const h = await (await fetch(base + '/api/health')).json();
      assert.equal(h.aiConfigured, false);
    } finally {
      server.close();
      if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    }
  });
});
