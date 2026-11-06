/**
 * PLUMBING + DETERMINISM TESTS for the analyst. The model is a scripted stub, so these
 * prove: tools return correct deterministic figures, the loop wires tool results back,
 * bad calls are survivable, ungrounded figures are flagged, and the HTTP route works.
 * They do NOT prove Gemini chooses good tools; that needs a live key (scripts/eval-live.ts).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { INITIAL_LINE_ITEMS as ITEMS, INITIAL_VENDORS, QUESTIONNAIRE_QUESTIONS, INITIAL_QUESTIONNAIRE_RESPONSES } from '../src/data/seedData';
import { deriveVendorData } from '../src/extraction/derive';
import { pendingCells, pendingVendor } from '../src/extraction/pending';
import { evaluateScenario } from '../src/services/procurementEngine';
import { runTool, ToolError, type AnalystState } from '../server/analyst-tools';
import { runAnalyst, findUngroundedFigures, MAX_ITERATIONS } from '../server/analyst';
import { createApp } from '../server/app';
import type { ModelClient, ToolCall, ToolTurnRequest } from '../server/model';
import type { ExtractedLine, VendorExtractionResult } from '../src/extraction/schema';

const ev = [{ documentName: 'd', kind: 'email_line' as const, locator: 'L1', page: null, snippet: 'x', boundingBox: null }];
const line = (n: number, price: number): ExtractedLine => ({
  vendorItemRef: String(n), rfxItemId: `PKG-HYD-${String(n).padStart(3, '0')}`, description: null, status: 'quoted', unitPrice: price, currency: 'INR',
  priceUnit: ITEMS[n - 1].standardUom, quantity: null, taxBasis: 'unspecified', freightNote: null, notes: null, confidence: 0.95, evidence: ev,
});
const res = (lines: ExtractedLine[]): VendorExtractionResult => ({
  meta: { documentName: 'd', documentFormat: 'eml', sha256: 'a', bytes: 1, model: 'm', inputMode: 'parsed_text', startedAt: 't', finishedAt: 't' },
  raw: { terms: { vendorName: null, contactPerson: null, contactEmail: null, paymentTerms: null, validity: null, deliveryLeadTimeDays: { days: 10, asWritten: '10 days', evidence: ev }, freight: null, tax: null, documentCurrency: 'INR', discounts: [], otherTerms: [] }, lines, missingInformation: [], reviewFlags: [] },
  lineEvidenceChecks: lines.map(() => ['verified_in_source']), validationIssues: [],
});

// Two vendors have prices: APEX is cheaper on items 1-3; GLOBAL cheaper on item 4. Others untouched (pending).
function buildState(): AnalystState {
  const vendors = INITIAL_VENDORS.map(pendingVendor);
  let cells = pendingCells(INITIAL_VENDORS, ITEMS);
  const apply = (vid: string, lines: ExtractedLine[]) => {
    const v = vendors.find((x) => x.id === vid)!;
    const d = deriveVendorData(v, res(lines), ITEMS);
    cells = [...cells.filter((c) => c.vendorId !== vid), ...d.cells];
    Object.assign(v, d.vendorPatch, { documentFileName: 'f' });
  };
  apply('V-APEX', [line(1, 100), line(2, 200), line(3, 300), line(4, 450)]);
  apply('V-GLOBAL', [line(1, 110), line(2, 190), line(3, 310), line(4, 400)]);
  // Sample questionnaire answers: every supplier, as shipped.
  const responses = INITIAL_QUESTIONNAIRE_RESPONSES.map((r) => ({ ...r, origin: 'sample_input' as const, buyerVerified: false }));
  return { lineItems: ITEMS, vendors, quoteCells: cells, questions: QUESTIONNAIRE_QUESTIONS, responses, exceptions: [], usdToInrRate: 83.5 };
}

describe('analyst tools are deterministic and correct', () => {
  const st = buildState();

  test('line-item comparison picks the true cheapest and flags the missing quotes', () => {
    const r = runTool('get_line_item_comparison', { itemIds: ['PKG-HYD-001', 'PKG-HYD-004'] }, st);
    const items = r.data.items as { itemId: string; cheapest: { supplier: string; priceInr: number } | null; suppliersWithoutUsablePrice: number }[];
    assert.equal(items[0].cheapest?.priceInr, 100);
    assert.match(items[0].cheapest!.supplier, /Apex/);
    assert.equal(items[1].cheapest?.priceInr, 400);
    assert.match(items[1].cheapest!.supplier, /Global/);
    assert.equal(items[0].suppliersWithoutUsablePrice, 3); // three suppliers have nothing
    assert.ok(r.table && r.table.rows.length === 2);
  });

  test('scenario tool equals the engine called directly (no second implementation)', () => {
    const r = runTool('evaluate_award_scenario', { strategy: 'cheapest_eligible_split', enforceMandatoryQuestions: false }, st);
    const direct = evaluateScenario(
      { id: 'x', name: 'x', strategy: 'cheapest_eligible_split', includedVendorIds: st.vendors.map((v) => v.id), enforceMandatoryQualityGate: false, includeUnverifiedAssumptions: false, usdToInrRate: 83.5, applyGlobalFootnoteDiscount: true, standardFreightOverridePct: null, maxLeadTimeDaysFilter: 21 },
      st.lineItems, st.vendors, st.quoteCells, st.questions, st.responses, st.exceptions);
    assert.equal((r.data.totalCost as { inr: number }).inr, Number(direct.totalProcurementCostInr.toFixed(2)));
    assert.equal(r.data.awardedLines, direct.awardedLineItemsCount);
    assert.equal(r.data.awardedLines, 4); // only 4 lines have any price
    assert.ok(String(r.data.caveat).includes('26')); // 26 unpriced lines disclosed
  });

  test('single-vendor scenario only awards that vendor', () => {
    const r = runTool('evaluate_award_scenario', { strategy: 'single_vendor_custom', singleVendorId: 'V-APEX', enforceMandatoryQuestions: false }, st);
    const sup = r.data.suppliers as { supplier: string }[];
    assert.equal(sup.length, 1);
    assert.match(sup[0].supplier, /Apex/);
  });

  test('errors are explained, not swallowed', () => {
    assert.throws(() => runTool('get_vendor_summary', { vendorId: 'V-NOPE' }, st), ToolError);
    assert.throws(() => runTool('get_line_item_comparison', { itemIds: ['PKG-HYD-999'] }, st), ToolError);
    assert.throws(() => runTool('evaluate_award_scenario', { strategy: 'single_vendor_custom' }, st), ToolError);
    assert.throws(() => runTool('does_not_exist', {}, st), ToolError);
  });

  test('overview on an empty project says nothing has been processed', () => {
    const empty: AnalystState = { ...st, vendors: INITIAL_VENDORS.map(pendingVendor), quoteCells: pendingCells(INITIAL_VENDORS, ITEMS) };
    const r = runTool('get_project_overview', {}, empty);
    assert.match(String(r.data.note), /No vendor document/);
    assert.equal((r.data.cells as { usable: number }).usable, 0);
  });

  test('evidence tool returns the cited text and trust level', () => {
    const r = runTool('get_cell_evidence', { itemId: 'PKG-HYD-001', vendorId: 'V-APEX' }, st);
    assert.equal(r.data.trust, 'system_validated');
    assert.equal((r.data.evidence as unknown[]).length, 1);
  });

  test('questionnaire tool labels the data as sample input', () => {
    const r = runTool('get_questionnaire_outcomes', {}, st);
    assert.match(String(r.data.dataOrigin), /sample_input/);
  });
});

function scripted(script: ((req: ToolTurnRequest) => { text?: string; calls?: ToolCall[] })[], seen: ToolTurnRequest[] = []): ModelClient {
  let i = 0;
  return {
    modelName: 'stub',
    async generateJson() { throw new Error('unused'); },
    async generateToolTurn(req) {
      seen.push(JSON.parse(JSON.stringify(req)));
      const step = script[Math.min(i++, script.length - 1)](req);
      return { text: step.text ?? '', calls: step.calls ?? [], modelParts: [{ text: step.text ?? '' }] };
    },
  };
}

describe('analyst loop (scripted model)', () => {
  const st = buildState();

  test('model-chosen tool call -> tool result fed back -> grounded answer with table', async () => {
    const seen: ToolTurnRequest[] = [];
    const m = scripted([
      () => ({ calls: [{ name: 'get_line_item_comparison', args: { itemIds: ['PKG-HYD-004'] } }] }),
      (req) => {
        const last = req.contents.at(-1) as { parts: { functionResponse: { response: { tableId: string } } }[] };
        return { text: `Global is cheapest on PKG-HYD-004 at 400.\nTABLES: ${last.parts[0].functionResponse.response.tableId}` };
      },
    ], seen);
    const out = await runAnalyst('Who is cheapest on item 4?', [], st, m);
    assert.match(out.answer, /Global/);
    assert.ok(!out.answer.includes('TABLES'));
    assert.equal(out.tables.length, 1);
    assert.deepEqual(out.ungroundedFigures, []);
    assert.equal(out.toolTrace[0].name, 'get_line_item_comparison');
    assert.ok(out.toolTrace[0].ok);
    assert.equal(seen.length, 2);
    assert.match(seen[0].system, /never calculate/i);
  });

  test('a figure the model invents is flagged as ungrounded', async () => {
    const m = scripted([
      () => ({ calls: [{ name: 'get_line_item_comparison', args: { itemIds: ['PKG-HYD-004'] } }] }),
      () => ({ text: 'Global is cheapest at 400 and saves 777 rupees overall.' }),
    ]);
    const out = await runAnalyst('q', [], st, m);
    assert.deepEqual(out.ungroundedFigures, ['777']);
  });

  test('a bad tool call is reported back to the model and the loop continues', async () => {
    let sawError = false;
    const m = scripted([
      () => ({ calls: [{ name: 'get_vendor_summary', args: { vendorId: 'V-NOPE' } }] }),
      (req) => { sawError = JSON.stringify(req.contents.at(-1)).includes('Unknown vendorId'); return { text: 'That supplier does not exist in this project.' }; },
    ]);
    const out = await runAnalyst('q', [], st, m);
    assert.ok(sawError);
    assert.equal(out.toolTrace[0].ok, false);
    assert.match(out.answer, /does not exist/);
  });

  test('a model that never stops calling tools is cut off with an honest message', async () => {
    const m = scripted([() => ({ calls: [{ name: 'get_project_overview', args: {} }] })]);
    const out = await runAnalyst('q', [], st, m);
    assert.equal(out.stoppedEarly, true);
    assert.match(out.answer, /could not finish/i);
    assert.ok(out.toolTrace.length <= MAX_ITERATIONS);
  });

  test('table ids the model makes up are ignored', async () => {
    const m = scripted([() => ({ text: 'No data.\nTABLES: T99' })]);
    const out = await runAnalyst('q', [], st, m);
    assert.equal(out.tables.length, 0);
  });

  test('prior turns are passed as context', async () => {
    const seen: ToolTurnRequest[] = [];
    await runAnalyst('and for item 2?', [{ role: 'user', text: 'cheapest on item 1?' }, { role: 'assistant', text: 'Apex.' }], st, scripted([() => ({ text: 'ok' })], seen));
    assert.equal(seen[0].contents.length, 3);
  });
});

describe('grounding check', () => {
  test('accepts rounded and comma-formatted figures, ignores ids and small counts', () => {
    const outs = [JSON.stringify({ a: 1234567.891, display: '₹12,34,568', lakhs: '₹12.35 L' })];
    assert.deepEqual(findUngroundedFigures('Total ₹12,34,568 (₹12.35 L), item PKG-HYD-012, 3 suppliers, 1234567.89', outs), []);
    assert.deepEqual(findUngroundedFigures('Total 999999', outs), ['999999']);
  });
});

describe('HTTP /api/analyst', () => {
  test('returns an analysis; without a key returns 503 and no data', async () => {
    const st = buildState();
    const app = createApp({ getModel: () => scripted([() => ({ text: 'There are 5 suppliers.' })]) });
    const server = app.listen(0);
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const r = await fetch(base + '/api/analyst', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'How many suppliers?', state: st }) });
      const j = await r.json();
      assert.equal(r.status, 200);
      assert.match(j.answer, /5 suppliers/);
      const bad = await fetch(base + '/api/analyst', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: '' }) });
      assert.equal(bad.status, 400);
      const h = await (await fetch(base + '/api/health')).json();
      assert.equal(h.capabilities.analyst, true);
    } finally { server.close(); }
    const prev = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
    const s2 = createApp().listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/analyst`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'hi', state: st }) });
      assert.equal(r.status, 503);
      assert.equal((await r.json()).error, 'GEMINI_KEY_MISSING');
    } finally { s2.close(); if (prev !== undefined) process.env.GEMINI_API_KEY = prev; }
  });
});
