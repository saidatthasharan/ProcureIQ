/** PLUMBING TESTS (stub model): validation, protection of buyer-approved items, HTTP behaviour. They do not test Gemini's drafting quality. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { INITIAL_LINE_ITEMS as ITEMS, QUESTIONNAIRE_QUESTIONS as QS } from '../src/data/seedData';
import { runCopilot, CopilotError, COPILOT_JSON_SCHEMA, type CopilotRfxState } from '../server/copilot';
import { createApp } from '../server/app';
import type { GenerateJsonRequest, ModelClient } from '../server/model';

const rfx: CopilotRfxState = {
  title: 'T', scopeSummary: 'Scope A', deliveryDays: 15, paymentDays: 45,
  lineItems: ITEMS.map((i, n) => ({ id: i.id, description: i.description, category: i.category, technicalSpec: i.technicalSpec, burstingStrengthCS: i.burstingStrengthCS, gsmAndFlute: i.gsmAndFlute, dimensionsMm: i.dimensionsMm, quantity: i.quantity, standardUom: i.standardUom, qualityRequirement: i.qualityRequirement, targetDeliveryDays: i.targetDeliveryDays, approvalStatus: n < 2 ? 'ai_generated' : 'buyer_approved' })),
  questions: QS.map((q) => ({ id: q.id, category: q.category, questionText: q.questionText, mandatoryCriterion: q.mandatoryCriterion, weightPct: q.weightPct })),
};
const empty = { reply: 'No changes.', needsClarification: null, scope: { title: null, scopeSummary: null, deliveryDays: null, paymentDays: null }, addLineItems: [], updateLineItems: [], addQuestions: [], setMandatory: [] };
const stub = (answers: unknown[], seen: GenerateJsonRequest[] = []): ModelClient => {
  let i = 0;
  return { modelName: 'stub', async generateJson(r) { seen.push(r); const a = answers[Math.min(i++, answers.length - 1)]; return { text: typeof a === 'string' ? a : JSON.stringify(a), schemaMode: 'json_schema' }; }, async generateToolTurn() { throw new Error('unused'); } };
};

describe('copilot proposal checks', () => {
  test('sends the real RFx and the instruction; passes a schema', async () => {
    const seen: GenerateJsonRequest[] = [];
    await runCopilot('make delivery 10 days', [], rfx, stub([empty], seen));
    const text = (seen[0].parts[0] as { text: string }).text;
    assert.match(text, /PKG-HYD-001/);
    assert.match(text, /BUYER INSTRUCTION:\nmake delivery 10 days/);
    assert.ok((COPILOT_JSON_SCHEMA as { properties: Record<string, unknown> }).properties.addLineItems);
  });

  test('changes to buyer-approved items are flagged as protected; AI-draft items are not', async () => {
    const r = await runCopilot('x', [], rfx, stub([{ ...empty, updateLineItems: [{ id: 'PKG-HYD-001', changes: { quantity: 5 } }, { id: 'PKG-HYD-005', changes: { quantity: 7 } }] }]));
    assert.deepEqual(r.protectedItemIds, ['PKG-HYD-005']);
    assert.equal(r.proposal.updateLineItems.length, 2);
  });

  test('changes to items that do not exist are dropped with a warning', async () => {
    const r = await runCopilot('x', [], rfx, stub([{ ...empty, updateLineItems: [{ id: 'PKG-HYD-999', changes: { quantity: 5 } }], setMandatory: [{ questionId: 'Q-99', mandatory: true }] }]));
    assert.equal(r.proposal.updateLineItems.length, 0);
    assert.equal(r.proposal.setMandatory.length, 0);
    assert.equal(r.warnings.filter((w) => /no such/.test(w)).length, 2);
  });

  test('no-op changes are removed (same value as today)', async () => {
    const r = await runCopilot('x', [], rfx, stub([{ ...empty, scope: { title: 'T', scopeSummary: 'Scope A', deliveryDays: 15, paymentDays: 30 }, setMandatory: [{ questionId: 'Q-01', mandatory: true }] }]));
    assert.equal(r.proposal.scope.deliveryDays, null);
    assert.equal(r.proposal.scope.paymentDays, 30);
    assert.equal(r.proposal.setMandatory.length, 0); // Q-01 already mandatory
  });

  test('new items and questions carry honest warnings (no prices; non-mandatory)', async () => {
    const item = { description: 'Test carton', category: '5-Ply Corrugated Boxes', technicalSpec: 's', burstingStrengthCS: 'Min 20', gsmAndFlute: 'g', dimensionsMm: 'd', quantity: 100, standardUom: 'Box', qualityRequirement: 'q' };
    const r = await runCopilot('x', [], rfx, stub([{ ...empty, addLineItems: [item], addQuestions: [{ category: 'Quality & Certifications', questionText: 'Do you test?', weightPct: 5, minimumRequirementDescription: 'm' }] }]));
    assert.ok(r.warnings.some((w) => /baseline price/.test(w)));
    assert.ok(r.warnings.some((w) => /not mandatory/.test(w)));
  });

  test('structurally invalid output is repaired once, then rejected', async () => {
    const seen: GenerateJsonRequest[] = [];
    const ok = await runCopilot('x', [], rfx, stub(['not json', empty], seen));
    assert.equal(seen.length, 2);
    assert.equal(ok.proposal.reply, 'No changes.');
    await assert.rejects(() => runCopilot('x', [], rfx, stub([{ ...empty, addLineItems: [{ description: 'x' }] }, 'bad'])), CopilotError);
  });

  test('out-of-range values are rejected (negative quantity, unknown category)', async () => {
    const bad = { description: 'Test carton', category: 'Magic Boxes', technicalSpec: 's', burstingStrengthCS: 'b', gsmAndFlute: 'g', dimensionsMm: 'd', quantity: -5, standardUom: 'Box', qualityRequirement: 'q' };
    await assert.rejects(() => runCopilot('x', [], rfx, stub([{ ...empty, addLineItems: [bad] }])), CopilotError);
  });
});

describe('HTTP /api/copilot', () => {
  test('works with a stub, 400 on bad body, 503 without key', async () => {
    const s = createApp({ getModel: () => stub([empty]) }).listen(0);
    try {
      const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
      const post = (b: unknown) => fetch(base + '/api/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      assert.equal((await post({ instruction: 'hi', rfx })).status, 200);
      assert.equal((await post({ instruction: '' })).status, 400);
    } finally { s.close(); }
    const prev = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
    const s2 = createApp().listen(0);
    try {
      const r = await fetch(`http://127.0.0.1:${(s2.address() as AddressInfo).port}/api/copilot`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instruction: 'hi', rfx }) });
      assert.equal(r.status, 503);
    } finally { s2.close(); if (prev !== undefined) process.env.GEMINI_API_KEY = prev; }
  });
});
