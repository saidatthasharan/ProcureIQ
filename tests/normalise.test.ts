import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_LINE_ITEMS } from '../src/data/seedData';
import {
  resolveUnit,
  resolveCurrency,
  normaliseLine,
  combineDiscounts,
  matchLineToItem,
  DEFAULT_SETTINGS,
} from '../src/extraction/normalise';
import type { ExtractedLine, VendorTerms } from '../src/extraction/schema';

const ev = [{ documentName: 't', kind: 'xlsx_cell' as const, locator: 'A1', page: null, snippet: 'x', boundingBox: null }];
const item = (n: number) => INITIAL_LINE_ITEMS[n - 1];

function line(p: Partial<ExtractedLine>): ExtractedLine {
  return {
    vendorItemRef: null, rfxItemId: null, description: null, status: 'quoted',
    unitPrice: 100, currency: 'INR', priceUnit: 'Box', quantity: null, taxBasis: 'exclusive',
    freightNote: null, notes: null, confidence: 0.9, evidence: ev, ...p,
  };
}
function terms(p: Partial<VendorTerms> = {}): VendorTerms {
  return {
    vendorName: null, contactPerson: null, contactEmail: null, paymentTerms: null, validity: null,
    deliveryLeadTimeDays: null, freight: null, tax: null, documentCurrency: 'INR', discounts: [], otherTerms: [], ...p,
  };
}

describe('unit conversion', () => {
  test('same unit -> factor 1', () => {
    const r = resolveUnit('Box', 'Box');
    assert.ok(r.ok && r.factor === 1);
  });
  test('Piece and Box are both "each"', () => {
    const r = resolveUnit('Pcs', 'Box');
    assert.ok(r.ok && r.factor === 1);
  });
  test('per 100 pieces -> 0.01', () => {
    const r = resolveUnit('100 Pieces', 'Box');
    assert.ok(r.ok && r.factor === 0.01);
  });
  test('per 1000 -> 0.001', () => {
    const r = resolveUnit('per 1000 boxes', 'Box');
    assert.ok(r.ok && r.factor === 0.001);
  });
  test('metric tonne for a Kg item -> 0.001', () => {
    const r = resolveUnit('Metric Tonne', 'Kg');
    assert.ok(r.ok && r.factor === 0.001);
  });
  test('tonne for a Box item is refused', () => {
    assert.equal(resolveUnit('Metric Tonne', 'Box').ok, false);
  });
  test('"Pallet Load" with no count is refused, not guessed', () => {
    const r = resolveUnit('Pallet Load', 'Sheet');
    assert.equal(r.ok, false);
  });
  test('"Pallet of 250 sheets" is resolved from the stated count', () => {
    const r = resolveUnit('Pallet of 250 sheets', 'Sheet');
    assert.ok(r.ok && Math.abs(r.factor - 1 / 250) < 1e-12);
  });
  test('wrong kind of unit is refused', () => {
    assert.equal(resolveUnit('Roll', 'Box').ok, false);
  });
  test('missing unit is refused', () => {
    assert.equal(resolveUnit(null, 'Box').ok, false);
  });
});

describe('currency', () => {
  test('recognises INR forms', () => {
    for (const c of ['INR', 'Rs.', '₹', 'rupees']) assert.equal(resolveCurrency(c, null), 'INR');
  });
  test('recognises USD forms', () => {
    for (const c of ['USD', '$', 'US$']) assert.equal(resolveCurrency(c, null), 'USD');
  });
  test('falls back to document currency', () => {
    assert.equal(resolveCurrency(null, 'INR'), 'INR');
  });
  test('unknown currency -> null', () => {
    assert.equal(resolveCurrency('EUR', null), null);
  });
});

describe('price formula', () => {
  test('USD is converted with the configured rate', () => {
    const r = normaliseLine(line({ unitPrice: 12, currency: 'USD' }), terms(), item(1), { ...DEFAULT_SETTINGS, usdToInrRate: 83.5 });
    assert.equal(r.priceInr, 1002); // 12 x 83.5
  });
  test('FX rate change flows through', () => {
    const r = normaliseLine(line({ unitPrice: 10, currency: 'USD' }), terms(), item(1), { ...DEFAULT_SETTINGS, usdToInrRate: 90 });
    assert.equal(r.priceInr, 900);
  });
  test('per-100 pricing becomes per-unit', () => {
    const r = normaliseLine(line({ unitPrice: 1950, priceUnit: '100 Pieces' }), terms(), item(7));
    assert.equal(r.priceInr, 19.5);
  });
  test('per-tonne pricing for the Kg item', () => {
    const r = normaliseLine(line({ unitPrice: 60450, priceUnit: 'Metric Tonne' }), terms(), item(21));
    assert.equal(r.priceInr, 60.45);
  });
  test('conditional 4.5% discount is applied and its condition is kept', () => {
    const t = terms({ discounts: [{ description: 'volume rebate', percent: 4.5, condition: 'award above Rs 25,00,000', minAwardValueInr: 2500000, evidence: ev }] });
    const r = normaliseLine(line({ unitPrice: 100 }), t, item(1));
    assert.equal(r.priceInr, 95.5);
    assert.equal(r.discountConditions.length, 1);
  });
  test('GST-inclusive price with stated 18% is divided by 1.18', () => {
    const t = terms({ tax: { basis: 'inclusive', ratePercent: 18, asWritten: 'incl. 18% GST', evidence: ev } });
    const r = normaliseLine(line({ unitPrice: 118, taxBasis: 'unspecified' }), t, item(1));
    assert.equal(r.priceInr, 100);
  });
  test('GST-inclusive with no rate is blocked, with provisional shown', () => {
    const t = terms({ tax: { basis: 'inclusive', ratePercent: null, asWritten: 'incl. GST', evidence: ev } });
    const r = normaliseLine(line({ unitPrice: 118, taxBasis: 'unspecified' }), t, item(1));
    assert.equal(r.priceInr, null);
    assert.ok(r.blockReasons.includes('tax_rate_missing'));
    assert.equal(r.provisionalPriceInr, 100);
  });
  test('a line that contradicts the document on GST is flagged', () => {
    const t = terms({ tax: { basis: 'inclusive', ratePercent: 18, asWritten: '', evidence: ev } });
    const r = normaliseLine(line({ unitPrice: 100, taxBasis: 'exclusive' }), t, item(1));
    assert.equal(r.priceInr, 100);
    assert.ok(r.assumptions.some((a) => a.includes('line-level')));
  });
  test('extra freight of 3.5% is added', () => {
    const t = terms({ freight: { basis: 'extra_percent', extraPercent: 3.5, asWritten: '+3.5%', evidence: ev } });
    const r = normaliseLine(line({ unitPrice: 100 }), t, item(1));
    assert.equal(r.priceInr, 103.5);
  });
  test('freight charged extra but not quantified is blocked', () => {
    const t = terms({ freight: { basis: 'ex_works', extraPercent: null, asWritten: 'ex-works', evidence: ev } });
    const r = normaliseLine(line({ unitPrice: 100 }), t, item(1));
    assert.equal(r.priceInr, null);
    assert.ok(r.blockReasons.includes('freight_not_quantified'));
  });
  test('all adjustments together (USD, per-100, GST incl, discount, freight)', () => {
    const t = terms({
      tax: { basis: 'inclusive', ratePercent: 18, asWritten: '', evidence: ev },
      freight: { basis: 'extra_percent', extraPercent: 4, asWritten: '', evidence: ev },
      discounts: [{ description: 'd', percent: 5, condition: null, minAwardValueInr: null, evidence: ev }],
    });
    const r = normaliseLine(line({ unitPrice: 1000, currency: 'USD', priceUnit: '100 Pieces', taxBasis: 'unspecified' }), t, item(7), { ...DEFAULT_SETTINGS, usdToInrRate: 80 });
    // 1000 x 0.01 x 80 / 1.18 x 0.95 x 1.04
    assert.equal(r.priceInr, Math.round(((1000 * 0.01 * 80) / 1.18) * 0.95 * 1.04 * 100) / 100);
  });
  test('stacked discounts compound', () => {
    assert.equal(combineDiscounts([5, 5]), 9.75);
  });
});

describe('blocking: never invent a price', () => {
  test('not_quoted -> no price', () => {
    const r = normaliseLine(line({ status: 'not_quoted', unitPrice: null }), terms(), item(1));
    assert.equal(r.priceInr, null);
    assert.deepEqual(r.blockReasons, ['not_quoted']);
  });
  test('historical reference -> no price and no provisional', () => {
    const r = normaliseLine(line({ status: 'historical_reference', unitPrice: null }), terms(), item(9));
    assert.equal(r.priceInr, null);
    assert.equal(r.provisionalPriceInr, null);
    assert.ok(r.blockReasons.includes('historical_reference'));
  });
  test('historical reference is blocked even if the model passed a number', () => {
    const r = normaliseLine(line({ status: 'historical_reference', unitPrice: 27.2 }), terms(), item(9));
    assert.equal(r.priceInr, null);
    assert.equal(r.provisionalPriceInr, null);
  });
  test('unknown unit -> no price and no provisional', () => {
    const r = normaliseLine(line({ unitPrice: 8500, priceUnit: 'Pallet Load' }), terms(), item(19));
    assert.equal(r.priceInr, null);
    assert.equal(r.provisionalPriceInr, null);
    assert.ok(r.blockReasons.includes('unknown_unit'));
  });
  test('unknown currency -> blocked', () => {
    const r = normaliseLine(line({ currency: 'EUR' }), terms({ documentCurrency: null }), item(1));
    assert.equal(r.priceInr, null);
  });
  test('missing number -> blocked', () => {
    const r = normaliseLine(line({ unitPrice: null }), terms(), item(1));
    assert.equal(r.priceInr, null);
  });
  test('unstated tax and freight are surfaced as assumptions, not silent', () => {
    const r = normaliseLine(line({ taxBasis: 'unspecified' }), terms(), item(1));
    assert.equal(r.priceInr, 100);
    assert.equal(r.assumptions.length, 2);
  });
});

describe('line-item matching', () => {
  test('exact RFx id', () => {
    const m = matchLineToItem(line({ rfxItemId: 'PKG-HYD-012' }), INITIAL_LINE_ITEMS);
    assert.equal(m.itemId, 'PKG-HYD-012');
    assert.equal(m.method, 'rfx_id');
  });
  test('item code inside the description', () => {
    const m = matchLineToItem(line({ description: 'Carton CB3-STD-3020 as per RFQ' }), INITIAL_LINE_ITEMS);
    assert.equal(m.itemId, 'PKG-HYD-007');
  });
  test('bare line number is accepted only with a corroborating description', () => {
    const ok = matchLineToItem(line({ vendorItemRef: '7', description: '3-Ply Standard Component Mailer Box 300x200x150' }), INITIAL_LINE_ITEMS);
    assert.equal(ok.itemId, 'PKG-HYD-007');
    const bad = matchLineToItem(line({ vendorItemRef: '7', description: 'Completely unrelated steel drum' }), INITIAL_LINE_ITEMS);
    assert.equal(bad.itemId, null);
  });
  test('close description with different wording is matched', () => {
    const m = matchLineToItem(
      line({ description: 'Die-cut 5-ply folded corner cushion block 100x100x100mm' }),
      INITIAL_LINE_ITEMS
    );
    assert.equal(m.itemId, 'PKG-HYD-017');
  });
  test('garbage does not match', () => {
    const m = matchLineToItem(line({ description: 'Forklift hire' }), INITIAL_LINE_ITEMS);
    assert.equal(m.itemId, null);
  });
});
