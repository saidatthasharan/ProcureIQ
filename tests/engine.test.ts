/**
 * Scenario engine tests. Quote cells are built by the real derive step from
 * hand-written extraction results (plumbing input, not model output). The
 * expected numbers are computed independently inside each test.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_LINE_ITEMS as ITEMS, QUESTIONNAIRE_QUESTIONS as QUESTIONS, INITIAL_VENDORS } from '../src/data/seedData';
import { deriveVendorData } from '../src/extraction/derive';
import { calculateVendorQualification, evaluateScenario, getEffectiveCellPriceInr } from '../src/services/procurementEngine';
import type { ExtractedLine, VendorExtractionResult, VendorTerms } from '../src/extraction/schema';
import type { ScenarioConfig, Vendor, VendorQuestionnaireResponse, VendorQuoteCell } from '../src/types/procurement';

const ev = [{ documentName: 'd', kind: 'email_line' as const, locator: 'L1', page: null, snippet: 'x', boundingBox: null }];
const terms = (p: Partial<VendorTerms> = {}): VendorTerms => ({
  vendorName: null, contactPerson: null, contactEmail: null, paymentTerms: null, validity: null, deliveryLeadTimeDays: null,
  freight: null, tax: null, documentCurrency: 'INR', discounts: [], otherTerms: [], ...p,
});
const mkLine = (i: number, p: Partial<ExtractedLine>): ExtractedLine => ({
  vendorItemRef: String(i + 1), rfxItemId: ITEMS[i].id, description: null, status: 'quoted', unitPrice: 100, currency: 'INR', priceUnit: ITEMS[i].standardUom,
  quantity: null, taxBasis: 'unspecified', freightNote: null, notes: null, confidence: 0.95, evidence: ev, ...p,
});
const extraction = (lines: ExtractedLine[], t: VendorTerms = terms()): VendorExtractionResult => ({
  meta: { documentName: 'd', documentFormat: 'eml', sha256: 'x', bytes: 1, model: 'm', inputMode: 'parsed_text', startedAt: '', finishedAt: '' },
  raw: { terms: t, lines, missingInformation: [], reviewFlags: [] },
  lineEvidenceChecks: lines.map(() => ['verified_in_source']),
  validationIssues: [],
});

/** Build a vendor + cells where item i is priced baseline x factor(i) (null = not quoted). */
function build(id: string, factor: (i: number) => number | null, t: VendorTerms = terms(), lead?: number) {
  const lines = ITEMS.map((it, i) => {
    const f = factor(i);
    return f == null
      ? mkLine(i, { status: 'not_quoted', unitPrice: null })
      : mkLine(i, { unitPrice: Math.round(it.baselineUnitPriceInr * f * 100) / 100 });
  });
  const base = INITIAL_VENDORS.find((v) => v.id === id)!;
  const tt = lead ? { ...t, deliveryLeadTimeDays: { days: lead, asWritten: `${lead} days`, evidence: ev } } : t;
  const d = deriveVendorData(base, extraction(lines, tt), ITEMS);
  const vendor: Vendor = { ...base, ...d.vendorPatch, processingStatus: 'extracted_NeedsReview' } as Vendor;
  return { vendor, cells: d.cells, exceptions: d.exceptions };
}
const price = (it: number, f: number) => Math.round(ITEMS[it].baselineUnitPriceInr * f * 100) / 100;

function responses(passing: Record<string, boolean>): VendorQuestionnaireResponse[] {
  const out: VendorQuestionnaireResponse[] = [];
  for (const [vendorId, ok] of Object.entries(passing)) {
    for (const q of QUESTIONS) {
      out.push({ questionId: q.id, vendorId, answerText: 'a', evidenceDocument: '', scoreOutOf100: ok ? 90 : 40, passedMandatoryCheck: ok, buyerVerified: false });
    }
  }
  return out;
}
const config = (p: Partial<ScenarioConfig> = {}): ScenarioConfig => ({
  id: 't', name: 't', strategy: 'cheapest_eligible_split', includedVendorIds: ['V-APEX', 'V-GLOBAL', 'V-PRIMEPACK'],
  enforceMandatoryQualityGate: true, includeUnverifiedAssumptions: false, usdToInrRate: 83.5, applyGlobalFootnoteDiscount: true,
  standardFreightOverridePct: null, maxLeadTimeDaysFilter: 21, ...p,
});

// A: 0.90 everywhere. B: 0.95 everywhere except items 1-5 at 0.80 (cheaper). C: 0.70 everywhere (cheapest) but fails quality.
const A = build('V-APEX', () => 0.9, terms(), 12);
const B = build('V-GLOBAL', (i) => (i < 5 ? 0.8 : 0.95), terms(), 14);
const C = build('V-PRIMEPACK', () => 0.7, terms(), 10);
const vendors = [A.vendor, B.vendor, C.vendor];
const cells = [...A.cells, ...B.cells, ...C.cells];
const excs = [...A.exceptions, ...B.exceptions, ...C.exceptions];
const R = responses({ 'V-APEX': true, 'V-GLOBAL': true, 'V-PRIMEPACK': false });
const run = (c: ScenarioConfig, vs = vendors, cs = cells) => evaluateScenario(c, ITEMS, vs, cs, QUESTIONS, R, excs);
const baselineTotal = ITEMS.reduce((s, it) => s + it.quantity * it.baselineUnitPriceInr, 0);

describe('split award', () => {
  test('cheapest eligible split picks the lowest quote per line and totals correctly', () => {
    const r = run(config());
    let expected = 0;
    ITEMS.forEach((it, i) => (expected += it.quantity * Math.min(price(i, 0.9), price(i, i < 5 ? 0.8 : 0.95))));
    assert.ok(Math.abs(r.totalProcurementCostInr - expected) < 0.01, `${r.totalProcurementCostInr} vs ${expected}`);
    assert.equal(r.awardedLineItemsCount, 30);
    assert.equal(r.itemAllocations.slice(0, 5).every((a) => a.awardedVendorId === 'V-GLOBAL'), true);
    assert.equal(r.itemAllocations.slice(5).every((a) => a.awardedVendorId === 'V-APEX'), true);
  });

  test('savings = baseline - total', () => {
    const r = run(config());
    assert.ok(Math.abs(r.totalBaselineCostInr - baselineTotal) < 0.01);
    assert.ok(Math.abs(r.totalSavingsInr - (baselineTotal - r.totalProcurementCostInr)) < 0.01);
    assert.ok(Math.abs(r.savingsPct - (r.totalSavingsInr / baselineTotal) * 100) < 0.01);
  });

  test('the cheapest vendor is excluded when it fails the mandatory quality gate', () => {
    const r = run(config());
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId !== 'V-PRIMEPACK'));
    assert.equal(r.qualityComplianceStatus, '100% Compliant');
  });

  test('turning the gate off lets the cheapest vendor win and flags non-compliance', () => {
    const r = run(config({ enforceMandatoryQualityGate: false }));
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId === 'V-PRIMEPACK'));
    assert.equal(r.qualityComplianceStatus, 'Non-Compliant Override Active');
  });
});

describe('single-vendor award', () => {
  test('best overall single vendor = lowest total among eligible vendors with full coverage', () => {
    const r = run(config({ strategy: 'single_vendor_best_overall' }));
    const totalA = ITEMS.reduce((s, it, i) => s + it.quantity * price(i, 0.9), 0);
    const totalB = ITEMS.reduce((s, it, i) => s + it.quantity * price(i, i < 5 ? 0.8 : 0.95), 0);
    const winner = totalA < totalB ? 'V-APEX' : 'V-GLOBAL';
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId === winner));
    assert.ok(Math.abs(r.totalProcurementCostInr - Math.min(totalA, totalB)) < 0.01);
  });

  test('custom single vendor: awards everything to the chosen vendor', () => {
    const r = run(config({ strategy: 'single_vendor_custom', singleTargetVendorId: 'V-GLOBAL' }));
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId === 'V-GLOBAL'));
  });

  test('custom single vendor with NO target awards nothing (no hidden default vendor)', () => {
    const r = run(config({ strategy: 'single_vendor_custom', singleTargetVendorId: undefined }));
    assert.equal(r.awardedLineItemsCount, 0);
    assert.equal(r.unallocatedLineItemsCount, 30);
  });

  test('a vendor that skipped lines leaves them unallocated at baseline, with no savings claimed', () => {
    const partial = build('V-GLOBAL', (i) => (i < 20 ? 0.8 : null), terms(), 14);
    const vs = [A.vendor, partial.vendor];
    const cs = [...A.cells, ...partial.cells];
    const r = evaluateScenario(config({ strategy: 'single_vendor_custom', singleTargetVendorId: 'V-GLOBAL', includedVendorIds: ['V-APEX', 'V-GLOBAL'] }), ITEMS, vs, cs, QUESTIONS, R, []);
    assert.equal(r.awardedLineItemsCount, 20);
    assert.equal(r.unallocatedLineItemsCount, 10);
    const unalloc = r.itemAllocations.filter((a) => a.isFallbackOrUnallocated);
    assert.ok(unalloc.every((a) => a.savingsInr === 0 && a.unitPriceInr === null));
  });

  test('best-overall prefers the vendor with the most coverage over a cheaper partial vendor', () => {
    const partial = build('V-GLOBAL', (i) => (i < 10 ? 0.5 : null), terms(), 14); // very cheap but only 10 lines
    const r = evaluateScenario(config({ strategy: 'single_vendor_best_overall', includedVendorIds: ['V-APEX', 'V-GLOBAL'] }), ITEMS, [A.vendor, partial.vendor], [...A.cells, ...partial.cells], QUESTIONS, R, []);
    assert.equal(r.awardedLineItemsCount, 30);
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId === 'V-APEX'));
  });

  test('dual-vendor split uses the two best-coverage vendors, not hardcoded ones', () => {
    const r = run(config({ strategy: 'dual_vendor_resilient_split', enforceMandatoryQualityGate: false, includedVendorIds: ['V-APEX', 'V-GLOBAL', 'V-PRIMEPACK'], dualVendorIds: ['V-APEX', 'V-PRIMEPACK'] }));
    const used = new Set(r.itemAllocations.map((a) => a.awardedVendorId));
    assert.deepEqual([...used], ['V-PRIMEPACK']); // C is cheaper than A on every line
    const r2 = run(config({ strategy: 'dual_vendor_resilient_split', dualVendorIds: ['V-APEX', 'V-GLOBAL'] }));
    assert.ok(r2.itemAllocations.every((a) => ['V-APEX', 'V-GLOBAL'].includes(a.awardedVendorId as string)));
  });
});

describe('eligibility', () => {
  test('a vendor not yet extracted contributes nothing', () => {
    const pending = { ...A.vendor, processingStatus: 'unextracted' as const };
    const r = evaluateScenario(config({ includedVendorIds: ['V-APEX'] }), ITEMS, [pending], A.cells, QUESTIONS, R, []);
    assert.equal(r.awardedLineItemsCount, 0);
  });
  test('lead-time filter removes slower vendors', () => {
    const r = run(config({ maxLeadTimeDaysFilter: 13 }));
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId === 'V-APEX'));
  });
  test('a vendor whose document states no lead time is not silently treated as fastest', () => {
    const noLead = build('V-GLOBAL', () => 0.5); // no lead time stated, cheapest
    assert.equal(noLead.vendor.leadTimeStated, false);
    const r = evaluateScenario(config({ strategy: 'fastest_delivery_priority', includedVendorIds: ['V-APEX', 'V-GLOBAL'] }), ITEMS, [A.vendor, noLead.vendor], [...A.cells, ...noLead.cells], QUESTIONS, R, []);
    assert.ok(r.itemAllocations.every((a) => a.awardedVendorId === 'V-APEX'), 'the vendor with a stated 12-day lead time wins on speed');
  });
});

describe('qualification', () => {
  test('weighted score and mandatory pass', () => {
    const q = calculateVendorQualification('V-APEX', QUESTIONS, R);
    assert.equal(q.passedAllMandatory, true);
    assert.equal(q.weightedScore, 90);
  });
  test('failing a mandatory question fails the gate with a reason', () => {
    const q = calculateVendorQualification('V-PRIMEPACK', QUESTIONS, R);
    assert.equal(q.passedAllMandatory, false);
    assert.ok(q.failedMandatoryQuestions.length > 0);
  });
  test('an UNANSWERED mandatory question fails the gate (no silent pass)', () => {
    const q = calculateVendorQualification('V-ECOWRAP', QUESTIONS, R); // no responses at all
    assert.equal(q.passedAllMandatory, false);
    assert.ok(q.failedMandatoryQuestions.every((f) => /No response/.test(f.reason)));
  });
  test('answering all but one mandatory question still fails', () => {
    const mandatoryId = QUESTIONS.find((x) => x.mandatoryCriterion)!.id;
    const partial = R.filter((r) => !(r.vendorId === 'V-APEX' && r.questionId === mandatoryId));
    assert.equal(calculateVendorQualification('V-APEX', QUESTIONS, partial).passedAllMandatory, false);
  });
});

describe('currency and discount controls apply to any vendor', () => {
  const usd = (n: number) => extraction(ITEMS.map((_, i) => mkLine(i, { unitPrice: n, currency: 'USD' })), terms({
    discounts: [{ description: 'rebate', percent: 5, condition: 'award above 25L', minAwardValueInr: 2500000, evidence: ev }],
  }));
  const base = INITIAL_VENDORS.find((v) => v.id === 'V-PRIMEPACK')!; // deliberately NOT the vendor the old code special-cased for USD
  const d = deriveVendorData(base, usd(1), ITEMS);
  const vendor = { ...base, ...d.vendorPatch, processingStatus: 'extracted_NeedsReview' } as Vendor;

  test('FX rate from the scenario is used', () => {
    const e = getEffectiveCellPriceInr(d.cells[0], vendor, { usdToInrRate: 90, applyGlobalFootnoteDiscount: true });
    assert.equal(e.priceInr, 85.5); // 1 x 90 x 0.95
  });
  test('turning the conditional discount off removes it', () => {
    const e = getEffectiveCellPriceInr(d.cells[0], vendor, { usdToInrRate: 90, applyGlobalFootnoteDiscount: false });
    assert.equal(e.priceInr, 90);
  });
  test('a discounted cell is flagged as carrying an open assumption', () => {
    assert.equal(getEffectiveCellPriceInr(d.cells[0], vendor, {}).hasUnresolvedAssumption, true);
  });
  test('freight override applies only to cells that carry freight', () => {
    const t = terms({ freight: { basis: 'extra_percent', extraPercent: 3.5, asWritten: '+3.5%', evidence: ev } });
    const dd = deriveVendorData(base, extraction(ITEMS.map((_, i) => mkLine(i, { unitPrice: 100 })), t), ITEMS);
    const v2 = { ...base, ...dd.vendorPatch, processingStatus: 'extracted_NeedsReview' } as Vendor;
    assert.equal(getEffectiveCellPriceInr(dd.cells[0], v2, {}).priceInr, 103.5);
    assert.equal(getEffectiveCellPriceInr(dd.cells[0], v2, { standardFreightOverridePct: 5 }).priceInr, 105);
    assert.equal(getEffectiveCellPriceInr(cells[0], A.vendor, { standardFreightOverridePct: 5 }).priceInr, price(0, 0.9)); // DDP vendor unaffected
  });
});

describe('blocked values and buyer verification', () => {
  const hist = build('V-ECOWRAP', (i) => (i === 8 ? 0.9 : 0.9), terms(), 14);
  const h = deriveVendorData(INITIAL_VENDORS.find((v) => v.id === 'V-ECOWRAP')!, extraction(ITEMS.map((_, i) => (i === 8 ? mkLine(i, { status: 'historical_reference', unitPrice: null }) : mkLine(i, { unitPrice: 50 })))), ITEMS);
  const vendor = { ...hist.vendor, processingStatus: 'extracted_NeedsReview' } as Vendor;
  const blocked = h.cells.find((c) => c.itemId === ITEMS[8].id) as VendorQuoteCell;

  test('a historical reference never gets a price', () => {
    assert.equal(getEffectiveCellPriceInr(blocked, vendor, {}).priceInr, null);
    assert.equal(getEffectiveCellPriceInr(blocked, vendor, { includeUnverifiedAssumptions: true }).priceInr, null, 'even with unverified assumptions allowed: there is no number');
  });

  test('a buyer-confirmed price unblocks the cell and is used exactly', () => {
    const verified: VendorQuoteCell = { ...blocked, buyerVerified: true, trust: 'buyer_verified', isComparable: true, buyerConfirmedPriceInr: 27.5, validationStatus: 'buyer_verified' };
    const e = getEffectiveCellPriceInr(verified, vendor, {});
    assert.equal(e.priceInr, 27.5);
    assert.equal(e.hasUnresolvedAssumption, false);
  });

  test('scenario leaves a blocked line unallocated until verified, then allocates it', () => {
    const cs = h.cells;
    const r1 = evaluateScenario(config({ includedVendorIds: ['V-ECOWRAP'], enforceMandatoryQualityGate: false }), ITEMS, [vendor], cs, QUESTIONS, [], []);
    assert.equal(r1.unallocatedLineItemsCount, 1);
    const fixed = cs.map((c) => (c === blocked ? { ...c, buyerVerified: true, isComparable: true, buyerConfirmedPriceInr: 30, validationStatus: 'buyer_verified' as const } : c));
    const r2 = evaluateScenario(config({ includedVendorIds: ['V-ECOWRAP'], enforceMandatoryQualityGate: false }), ITEMS, [vendor], fixed, QUESTIONS, [], []);
    assert.equal(r2.unallocatedLineItemsCount, 0);
    assert.equal(r2.itemAllocations[8].unitPriceInr, 30);
  });

  test('values that are only AI-extracted are counted as open assumptions in the scenario', () => {
    const photo = deriveVendorData(INITIAL_VENDORS.find((v) => v.id === 'V-SOUTHERN')!, { ...extraction(ITEMS.map((_, i) => mkLine(i, { unitPrice: 50 }))), meta: { ...extraction([]).meta, documentFormat: 'image' }, lineEvidenceChecks: ITEMS.map(() => ['visual_unverified' as const]) }, ITEMS);
    const v = { ...INITIAL_VENDORS.find((x) => x.id === 'V-SOUTHERN')!, ...photo.vendorPatch, processingStatus: 'extracted_NeedsReview' } as Vendor;
    const r = evaluateScenario(config({ includedVendorIds: ['V-SOUTHERN'], enforceMandatoryQualityGate: false }), ITEMS, [v], photo.cells, QUESTIONS, [], []);
    assert.equal(r.awardedLineItemsCount, 30);
    assert.equal(r.unresolvedExceptionsIncludedCount, 30);
  });
});
