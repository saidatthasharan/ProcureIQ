/**
 * PLUMBING TESTS: these feed hand-built extraction results (what a model
 * would return) into the deterministic derive step. They do NOT test any AI
 * model. Live-model behaviour is covered by scripts/eval-live.ts, which needs
 * a Gemini key.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_LINE_ITEMS as ITEMS } from '../src/data/seedData';
import { deriveVendorData } from '../src/extraction/derive';
import type { EvidenceCheck, ExtractedLine, VendorExtractionResult, VendorTerms } from '../src/extraction/schema';

const ev = (snippet = 'x') => [{ documentName: 'd', kind: 'email_line' as const, locator: 'line 1', page: null, snippet, boundingBox: null }];
const VENDOR = { id: 'V-T', name: 'Test Vendor Pvt Ltd', shortName: 'Test Vendor' };

function terms(p: Partial<VendorTerms> = {}): VendorTerms {
  return {
    vendorName: { value: 'Test Vendor Pvt Ltd', evidence: ev() }, contactPerson: null, contactEmail: null, paymentTerms: null,
    validity: null, deliveryLeadTimeDays: null, freight: null, tax: null, documentCurrency: 'INR', discounts: [], otherTerms: [], ...p,
  };
}
function ln(n: number, p: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    vendorItemRef: String(n), rfxItemId: `PKG-HYD-${String(n).padStart(3, '0')}`, description: null, status: 'quoted',
    unitPrice: 100, currency: 'INR', priceUnit: 'Box', quantity: null, taxBasis: 'unspecified', freightNote: null,
    notes: null, confidence: 0.95, evidence: ev(), ...p,
  };
}
function result(lines: ExtractedLine[], t: VendorTerms = terms(), format: VendorExtractionResult['meta']['documentFormat'] = 'eml', checks?: EvidenceCheck[][]): VendorExtractionResult {
  return {
    meta: { documentName: 'd', documentFormat: format, sha256: 'abc', bytes: 1, model: 'test-model', inputMode: 'parsed_text', startedAt: 't', finishedAt: 't' },
    raw: { terms: t, lines, missingInformation: [], reviewFlags: [] },
    lineEvidenceChecks: checks ?? lines.map((l) => l.evidence.map(() => 'verified_in_source' as EvidenceCheck)),
    validationIssues: [],
  };
}
const cell = (d: ReturnType<typeof deriveVendorData>, n: number) => d.cells.find((c) => c.itemId === `PKG-HYD-${String(n).padStart(3, '0')}`)!;

describe('derive: integrity rules', () => {
  test('always returns exactly one cell per RFx item', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)]), ITEMS);
    assert.equal(d.cells.length, 30);
  });

  test('nothing is buyer-verified straight after extraction', () => {
    const d = deriveVendorData(VENDOR, result(ITEMS.map((_, i) => ln(i + 1))), ITEMS);
    assert.equal(d.cells.filter((c) => c.buyerVerified).length, 0);
    assert.ok(d.cells.every((c) => c.trust !== 'buyer_verified'));
    assert.notEqual(d.vendorPatch.validationStatus, 'Verified');
  });

  test('cleanly checked text lines become system_validated', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)]), ITEMS);
    assert.equal(cell(d, 1).trust, 'system_validated');
    assert.equal(cell(d, 1).isComparable, true);
    assert.equal(cell(d, 1).normalisedUnitPriceInr, 100);
  });

  test('image-sourced values are never system_validated', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)], terms(), 'image', [['visual_unverified']]), ITEMS);
    assert.equal(cell(d, 1).trust, 'ai_extracted');
    assert.equal(cell(d, 1).validationStatus, 'unverified_visual');
  });

  test('evidence not found in source -> not comparable, not validated, exception raised', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)], terms(), 'eml', [['not_found_in_source']]), ITEMS);
    assert.equal(cell(d, 1).trust, 'ai_extracted');
    assert.equal(cell(d, 1).isComparable, false);
    assert.equal(cell(d, 1).normalisedUnitPriceInr, null);
    assert.ok(d.exceptions.some((e) => e.itemId === 'PKG-HYD-001' && e.type === 'low_confidence'));
  });

  test('low model confidence blocks comparison and raises an exception', () => {
    const d = deriveVendorData(VENDOR, result([ln(4, { confidence: 0.6 })]), ITEMS);
    assert.equal(cell(d, 4).isComparable, false);
    assert.equal(cell(d, 4).validationStatus, 'low_confidence');
    assert.ok(d.exceptions.some((e) => e.itemId === 'PKG-HYD-004'));
  });
});

describe('derive: missing quotations', () => {
  test('explicit not_quoted: no price, no exception, counted separately', () => {
    const d = deriveVendorData(VENDOR, result([ln(27, { status: 'not_quoted', unitPrice: null })]), ITEMS);
    assert.equal(cell(d, 27).quoted, false);
    assert.equal(cell(d, 27).normalisedUnitPriceInr, null);
    assert.equal(d.exceptions.filter((e) => e.itemId === 'PKG-HYD-027').length, 0);
    assert.equal(d.vendorPatch.extractionRun?.counts.notQuoted, 1);
  });

  test('item not mentioned at all: missing cell plus a warning exception', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)]), ITEMS);
    assert.equal(cell(d, 2).quoted, false);
    assert.ok(d.exceptions.some((e) => e.itemId === 'PKG-HYD-002' && e.type === 'missing_item'));
    assert.equal(d.vendorPatch.extractionRun?.counts.notMentioned, 29);
  });

  test('counts reconcile: priced + historical + explicit-not-quoted + not-mentioned = 30', () => {
    const lines: ExtractedLine[] = [];
    for (let n = 1; n <= 18; n++) lines.push(ln(n)); // firm prices
    lines.push(ln(19, { unitPrice: 8500, priceUnit: 'Pallet Load' })); // priced, unit unknown
    for (const n of [9, 10]) lines[n - 1] = ln(n, { status: 'historical_reference', unitPrice: null }); // historical
    lines.push(ln(20, { status: 'historical_reference', unitPrice: null }));
    for (const n of [21, 22, 23]) lines.push(ln(n, { status: 'not_quoted', unitPrice: null }));
    const d = deriveVendorData(VENDOR, result(lines), ITEMS);
    const c = d.vendorPatch.extractionRun!.counts;
    assert.equal(c.priced + c.historicalReference + c.notQuoted + c.notMentioned + c.quotedWithoutPrice, 30);
    assert.equal(d.vendorPatch.itemsQuotedCount, c.priced);
  });

  test('counts reconcile even when the model returns an ambiguous line with no number', () => {
    const d = deriveVendorData(VENDOR, result([ln(1), ln(2, { status: 'ambiguous', unitPrice: null }), ln(3, { status: 'not_quoted', unitPrice: null })]), ITEMS);
    const c = d.vendorPatch.extractionRun!.counts;
    assert.equal(c.quotedWithoutPrice, 1);
    assert.equal(c.priced + c.historicalReference + c.notQuoted + c.notMentioned + c.quotedWithoutPrice, 30);
  });
});

describe('derive: unresolved values stay unresolved', () => {
  test('historical reference: blocked, no provisional price, critical exception, blocking rule', () => {
    const d = deriveVendorData(VENDOR, result([ln(9, { status: 'historical_reference', unitPrice: null })]), ITEMS);
    const c = cell(d, 9);
    assert.equal(c.isComparable, false);
    assert.equal(c.normalisedUnitPriceInr, null);
    assert.equal(c.provisionalUnitPriceInr, null);
    assert.equal(c.validationStatus, 'historical_reference');
    assert.ok(d.exceptions.some((e) => e.itemId === 'PKG-HYD-009' && e.severity === 'Critical'));
    assert.ok(d.rules.some((r) => r.category === 'Historical Price Reference' && r.blocksComparisonUntilVerified));
  });

  test('unknown unit: blocked with no guessed price and a blocked rule', () => {
    const d = deriveVendorData(VENDOR, result([ln(19, { unitPrice: 8500, priceUnit: 'Pallet Load' })]), ITEMS);
    const c = cell(d, 19);
    assert.equal(c.isComparable, false);
    assert.equal(c.provisionalUnitPriceInr, null);
    assert.equal(c.validationStatus, 'unknown_unit');
    assert.ok(d.rules.some((r) => r.verificationStatus === 'Blocked (Ambiguous)' && r.affectedItemIds.includes('PKG-HYD-019')));
  });

  test('two different prices for one item: conflict, both kept, neither used', () => {
    const d = deriveVendorData(VENDOR, result([ln(12, { unitPrice: 74.76 }), ln(12, { unitPrice: 79.5 })]), ITEMS);
    const c = cell(d, 12);
    assert.equal(c.validationStatus, 'conflicting_values');
    assert.equal(c.isComparable, false);
    assert.equal(c.normalisedUnitPriceInr, null);
    assert.equal(c.provisionalUnitPriceInr, 74.76);
    assert.equal(c.conflictSecondaryValueInr, 79.5);
  });

  test('same price stated twice is not a conflict', () => {
    const d = deriveVendorData(VENDOR, result([ln(12, { unitPrice: 80 }), ln(12, { unitPrice: 80 })]), ITEMS);
    assert.equal(cell(d, 12).validationStatus, 'verified');
    assert.equal(cell(d, 12).isComparable, true);
  });
});

describe('derive: discounts, currency, units, tax, freight end to end', () => {
  test('conditional discount is applied, flagged, and listed as a rule', () => {
    const t = terms({ discounts: [{ description: 'volume rebate', percent: 4.5, condition: 'award above Rs 25L', minAwardValueInr: 2500000, evidence: ev() }] });
    const d = deriveVendorData(VENDOR, result([ln(1, { unitPrice: 100 })], t), ITEMS);
    const c = cell(d, 1);
    assert.equal(c.normalisedUnitPriceInr, 95.5);
    assert.equal(c.validationStatus, 'footnote_discount_applied');
    assert.ok(c.discountConditions?.[0].includes('award above'));
    assert.ok(d.rules.some((r) => r.category === 'Footnote Discount'));
    assert.equal(d.vendorPatch.footnoteDiscountPct, 4.5);
  });

  test('USD lines convert and generate an FX rule that cites the configured rate', () => {
    const d = deriveVendorData(VENDOR, result([ln(1, { unitPrice: 10, currency: 'USD' })]), ITEMS, { settings: { usdToInrRate: 80, defaultGstRatePct: 18 }, minConfidence: 0.85 });
    assert.equal(cell(d, 1).normalisedUnitPriceInr, 800);
    assert.equal(d.rules.find((r) => r.category === 'Currency (FX)')?.conversionFactorOrRate, '80');
  });

  test('per-100 pricing yields a UOM rule', () => {
    const d = deriveVendorData(VENDOR, result([ln(7, { unitPrice: 1950, priceUnit: '100 Pieces' })]), ITEMS);
    assert.equal(cell(d, 7).normalisedUnitPriceInr, 19.5);
    assert.ok(d.rules.some((r) => r.category === 'Unit of Measure (UOM)' && r.affectedItemIds.includes('PKG-HYD-007')));
  });

  test('GST-inclusive and extra-freight vendor: both are normalised', () => {
    const t = terms({
      tax: { basis: 'inclusive', ratePercent: 18, asWritten: 'Prices include 18% GST', evidence: ev() },
      freight: { basis: 'extra_percent', extraPercent: 4, asWritten: 'Freight extra 4%', evidence: ev() },
    });
    const d = deriveVendorData(VENDOR, result([ln(1, { unitPrice: 118 })], t), ITEMS);
    assert.equal(cell(d, 1).normalisedUnitPriceInr, 104); // 118 / 1.18 x 1.04
    assert.equal(d.vendorPatch.freightExtraPct, 4);
  });

  test('missing lead time is recorded as not stated, never invented', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)]), ITEMS);
    assert.equal(d.vendorPatch.leadTimeStated, false);
  });

  test('lead time is taken from the document when present', () => {
    const t = terms({ deliveryLeadTimeDays: { days: 12, asWritten: '12 days', evidence: ev() } });
    const d = deriveVendorData(VENDOR, result([ln(1)], t), ITEMS);
    assert.equal(d.vendorPatch.deliveryLeadTimeDays, 12);
    assert.equal(d.vendorPatch.leadTimeStated, true);
  });
});

describe('derive: wrong-file and unmatched-line protection', () => {
  test('a document naming a different company is flagged', () => {
    const t = terms({ vendorName: { value: 'Completely Different Industries', evidence: ev() } });
    const d = deriveVendorData(VENDOR, result([ln(1)], t), ITEMS);
    assert.ok(d.vendorPatch.extractionRun?.reviewFlags.some((f) => f.includes('uploaded against')));
  });

  test('lines that match no RFx item are reported, not used', () => {
    const d = deriveVendorData(VENDOR, result([ln(1), { ...ln(1), rfxItemId: null, vendorItemRef: 'ZZ', description: 'Forklift hire' }]), ITEMS);
    assert.equal(d.unmatchedLines.length, 1);
    assert.equal(d.cells.length, 30);
  });

  test('exception ids are unique', () => {
    const d = deriveVendorData(VENDOR, result([ln(1)]), ITEMS);
    assert.equal(new Set(d.exceptions.map((e) => e.id)).size, d.exceptions.length);
  });
});
