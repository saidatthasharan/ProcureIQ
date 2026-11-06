/**
 * Deterministic normalisation. No AI in this file.
 *
 * Input: what the vendor document SAID (from the extraction schema).
 * Output: a comparable price in INR per RFx standard unit, ex-GST, delivered,
 * after discounts, plus an itemised breakdown and a list of reasons why a price
 * must NOT be used yet (block reasons).
 *
 *   price = raw x uomFactor x fx / (1 + gstInclusive%) x (1 - discount%) x (1 + freight%)
 *
 * Rule of thumb: if anything needed for the formula is unknown, we say so and
 * block the price. We never fill the gap with a plausible number.
 */
import type { LineItem } from '../types/procurement';
import type { ExtractedLine, VendorTerms } from './schema';

export interface NormalisationSettings {
  usdToInrRate: number;
  /** Used only when a vendor says "inclusive of GST" without a rate. */
  defaultGstRatePct: number;
}

export const DEFAULT_SETTINGS: NormalisationSettings = {
  usdToInrRate: 83.5,
  defaultGstRatePct: 18,
};

/* ---------------------------------------------------------------- units */

type UnitGroup = 'each' | 'set' | 'sheet' | 'roll' | 'kg';

const EACH_WORDS = ['box', 'boxes', 'piece', 'pieces', 'pc', 'pcs', 'nos', 'no', 'each', 'carton', 'cartons', 'unit', 'units', 'ea'];
const SET_WORDS = ['set', 'sets'];
const SHEET_WORDS = ['sheet', 'sheets', 'sht'];
const ROLL_WORDS = ['roll', 'rolls'];
const KG_WORDS = ['kg', 'kgs', 'kilogram', 'kilograms'];

function groupOfWord(w: string): UnitGroup | null {
  if (EACH_WORDS.includes(w)) return 'each';
  if (SET_WORDS.includes(w)) return 'set';
  if (SHEET_WORDS.includes(w)) return 'sheet';
  if (ROLL_WORDS.includes(w)) return 'roll';
  if (KG_WORDS.includes(w)) return 'kg';
  return null;
}

export function standardUnitGroup(stdUom: LineItem['standardUom']): UnitGroup {
  switch (stdUom) {
    case 'Box':
    case 'Piece':
      return 'each';
    case 'Set':
      return 'set';
    case 'Sheet':
      return 'sheet';
    case 'Roll':
      return 'roll';
    case 'Kg':
      return 'kg';
  }
}

export type UnitResolution =
  | { ok: true; factor: number; explanation: string }
  | { ok: false; reason: string };

/**
 * standard-unit price = quoted price x factor.
 * "per 100 pieces" -> 0.01; "per metric tonne" for a Kg item -> 0.001.
 */
export function resolveUnit(priceUnit: string | null, stdUom: LineItem['standardUom']): UnitResolution {
  if (!priceUnit || !priceUnit.trim()) {
    return { ok: false, reason: 'The document does not say what unit the price is for.' };
  }
  const raw = priceUnit.toLowerCase().replace(/[^a-z0-9. ]+/g, ' ').replace(/\bper\b/g, ' ').replace(/\s+/g, ' ').trim();
  const stdGroup = standardUnitGroup(stdUom);

  // Weight units that are bigger than a kilogram.
  if (/\b(metric )?(tonne|tonnes|ton|tons|mt)\b/.test(raw)) {
    if (stdGroup === 'kg') return { ok: true, factor: 1 / 1000, explanation: 'Price quoted per metric tonne (1,000 kg); divided by 1,000 to get price per kg.' };
    return { ok: false, reason: `Quoted per tonne but the RFx unit is ${stdUom}; weight per ${stdUom} is not stated.` };
  }
  if (/\bquintal\b/.test(raw)) {
    if (stdGroup === 'kg') return { ok: true, factor: 1 / 100, explanation: 'Price quoted per quintal (100 kg); divided by 100.' };
    return { ok: false, reason: `Quoted per quintal but the RFx unit is ${stdUom}.` };
  }

  // "<N> <unit>" e.g. "100 pieces", "1000 boxes", or a bare "100"/"1000".
  const multi = raw.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (multi) {
    const n = Number(multi[1]);
    const word = multi[2];
    if (n > 0) {
      if (!word) return { ok: false, reason: `Unit "${priceUnit}" has a quantity but no unit word.` };
      const g = groupOfWord(word);
      if (g === stdGroup) {
        return n === 1
          ? { ok: true, factor: 1, explanation: `Price per ${word} matches RFx unit ${stdUom}.` }
          : { ok: true, factor: 1 / n, explanation: `Price quoted per ${n} ${word}; divided by ${n} to get price per ${stdUom}.` };
      }
      if (g === null) return { ok: false, reason: `Unit "${priceUnit}" is not a recognised unit.` };
      return { ok: false, reason: `Unit "${priceUnit}" is a different kind of unit from the RFx unit ${stdUom}.` };
    }
  }

  // "pallet of 250 sheets", "bundle of 50 pcs"
  const container = raw.match(/\b(?:of|containing|with)\s+(\d+(?:\.\d+)?)\s*([a-z]+)\b/);
  if (container) {
    const n = Number(container[1]);
    const g = groupOfWord(container[2]);
    if (g === stdGroup && n > 0) {
      return { ok: true, factor: 1 / n, explanation: `Container price covering ${n} ${container[2]}; divided by ${n}.` };
    }
  }

  // Single plain unit word.
  const words = raw.split(' ');
  if (words.length === 1) {
    const g = groupOfWord(words[0]);
    if (g === stdGroup) return { ok: true, factor: 1, explanation: `Price per ${words[0]} matches RFx unit ${stdUom}.` };
    if (g) return { ok: false, reason: `Unit "${priceUnit}" differs from the RFx unit ${stdUom}.` };
  }

  // Containers with no count: pallet load, bundle, pack, lot, bale...
  if (/\b(pallet|bundle|pack|packet|lot|bale|load|consignment|truck)\b/.test(raw)) {
    return { ok: false, reason: `"${priceUnit}" is a container, but the document does not say how many ${stdUom.toLowerCase()}s it holds.` };
  }
  return { ok: false, reason: `Unit "${priceUnit}" is not recognised.` };
}

/* ------------------------------------------------------------- currency */

export function resolveCurrency(c: string | null, documentCurrency: string | null): 'INR' | 'USD' | null {
  const x = (c ?? documentCurrency ?? '').toLowerCase().replace(/[^a-z$₹]/g, '');
  if (!x) return null;
  if (['inr', 'rs', '₹', 'rupee', 'rupees'].includes(x)) return 'INR';
  if (['usd', '$', 'us$', 'ususd', 'usdollar', 'usdollars', 'dollar', 'dollars'].includes(x)) return 'USD';
  return null;
}

/* ---------------------------------------------------------- normalising */

export type BlockReason =
  | 'not_quoted'
  | 'no_price'
  | 'historical_reference'
  | 'ambiguous_price'
  | 'unknown_unit'
  | 'unknown_currency'
  | 'freight_not_quantified'
  | 'tax_rate_missing';

export interface PriceComponents {
  rawPrice: number;
  currency: 'INR' | 'USD';
  uomFactor: number;
  fxRate: number;
  gstInclusivePct: number;
  discountPct: number;
  freightPct: number;
}

export interface NormalisedLine {
  /** Final comparable price, or null when blocked. */
  priceInr: number | null;
  /** Best-effort figure when blocked only by freight/tax-rate (never for unknown units). */
  provisionalPriceInr: number | null;
  blockReasons: BlockReason[];
  blockDetails: string[];
  components: PriceComponents | null;
  /** Things we assumed that the buyer should see. */
  assumptions: string[];
  unitExplanation: string | null;
  /** Discount text kept so the UI can show the condition. */
  discountConditions: string[];
}

export function applyFormula(c: PriceComponents): number {
  const v =
    (c.rawPrice * c.uomFactor * c.fxRate) / (1 + c.gstInclusivePct / 100) * (1 - c.discountPct / 100) * (1 + c.freightPct / 100);
  return Math.round(v * 100) / 100;
}

/** Combine several percentage discounts one after another. */
export function combineDiscounts(percents: number[]): number {
  const keep = 1 - percents.reduce((acc, p) => acc * (1 - p / 100), 1);
  return Math.round(keep * 10000) / 100;
}

export function normaliseLine(
  line: ExtractedLine,
  terms: VendorTerms,
  item: LineItem,
  settings: NormalisationSettings = DEFAULT_SETTINGS
): NormalisedLine {
  const out: NormalisedLine = {
    priceInr: null,
    provisionalPriceInr: null,
    blockReasons: [],
    blockDetails: [],
    components: null,
    assumptions: [],
    unitExplanation: null,
    discountConditions: [],
  };
  const block = (r: BlockReason, d: string) => {
    out.blockReasons.push(r);
    out.blockDetails.push(d);
  };

  if (line.status === 'not_quoted') {
    block('not_quoted', 'Vendor did not quote this item.');
    return out;
  }
  if (line.status === 'historical_reference') {
    block('historical_reference', 'Vendor pointed to a past price instead of giving a current one.');
    return out;
  }
  if (line.status === 'ambiguous') {
    block('ambiguous_price', line.notes ?? 'The document does not make this price usable.');
  }
  if (line.unitPrice === null || !(line.unitPrice > 0)) {
    block('no_price', 'No price found for this line.');
    return out;
  }

  const currency = resolveCurrency(line.currency, terms.documentCurrency);
  if (!currency) block('unknown_currency', `Currency "${line.currency ?? terms.documentCurrency ?? 'not stated'}" is not recognised.`);

  const unit = resolveUnit(line.priceUnit, item.standardUom);
  if (!unit.ok) block('unknown_unit', unit.reason);
  else out.unitExplanation = unit.explanation;

  if (!currency || !unit.ok) return out; // Never guess currency or unit.

  // Tax
  const basis = line.taxBasis !== 'unspecified' ? line.taxBasis : terms.tax?.basis ?? 'unspecified';
  if (
    line.taxBasis !== 'unspecified' &&
    terms.tax &&
    terms.tax.basis !== 'unspecified' &&
    terms.tax.basis !== line.taxBasis
  ) {
    out.assumptions.push(
      `This line says GST is ${line.taxBasis} but the document says ${terms.tax.basis}; the line-level statement was used.`
    );
  }
  let gstInclusivePct = 0;
  if (basis === 'inclusive') {
    if (terms.tax?.ratePercent != null) gstInclusivePct = terms.tax.ratePercent;
    else {
      gstInclusivePct = settings.defaultGstRatePct;
      out.assumptions.push(`Price is GST-inclusive but the document gives no rate; the default ${settings.defaultGstRatePct}% from settings was used.`);
      block('tax_rate_missing', 'GST-inclusive price with no stated GST rate.');
    }
  } else if (basis === 'unspecified') {
    out.assumptions.push('The document does not say whether the price includes GST; treated as excluding GST.');
  }

  // Freight
  const f = terms.freight;
  let freightPct = 0;
  if (f && (f.basis === 'ex_works' || f.basis === 'extra_percent')) {
    if (f.extraPercent != null) freightPct = f.extraPercent;
    else block('freight_not_quantified', 'Freight is charged extra but no percentage or amount is stated.');
  } else if (!f || f.basis === 'unspecified') {
    out.assumptions.push('The document does not say whether freight is included; treated as included.');
  }

  // Discounts (every extracted discount that has a percentage)
  const disc = terms.discounts.filter((d) => d.percent != null && d.percent > 0);
  const discountPct = combineDiscounts(disc.map((d) => d.percent as number));
  for (const d of disc) {
    if (d.condition || d.minAwardValueInr != null) {
      out.discountConditions.push(`${d.percent}% - ${d.condition ?? `award value of at least INR ${d.minAwardValueInr}`}`);
    }
  }

  const components: PriceComponents = {
    rawPrice: line.unitPrice,
    currency,
    uomFactor: unit.factor,
    fxRate: currency === 'USD' ? settings.usdToInrRate : 1,
    gstInclusivePct,
    discountPct,
    freightPct,
  };
  out.components = components;
  const value = applyFormula(components);
  if (out.blockReasons.length === 0) out.priceInr = value;
  else out.provisionalPriceInr = value;
  return out;
}

/* ------------------------------------------------------ line-item matching */

export interface MatchResult {
  itemId: string | null;
  method: 'rfx_id' | 'item_code' | 'ref_number_with_description' | 'description_match' | 'none';
  score: number;
  note: string | null;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'a', 'an', 'to', 'in', 'mm', 'ply']);

export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d)\s*[x×]\s*(?=\d)/g, '$1 ')
    .replace(/[^a-z0-9.]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 0 && !STOP.has(t));
}

export function similarity(a: string, b: string): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  A.forEach((t) => {
    if (B.has(t)) inter++;
  });
  return inter / (A.size + B.size - inter);
}

function compact(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function matchLineToItem(line: ExtractedLine, items: LineItem[]): MatchResult {
  // 1. Vendor used our item id.
  if (line.rfxItemId) {
    const want = compact(line.rfxItemId);
    const hit = items.find((i) => compact(i.id) === want);
    if (hit) return { itemId: hit.id, method: 'rfx_id', score: 1, note: null };
  }
  // 2. Vendor used our item code, in its ref or description.
  const hay = compact(`${line.vendorItemRef ?? ''} ${line.rfxItemId ?? ''} ${line.description ?? ''}`);
  const byCode = items.filter((i) => compact(i.code).length >= 6 && hay.includes(compact(i.code)));
  if (byCode.length === 1) return { itemId: byCode[0].id, method: 'item_code', score: 1, note: null };

  // 3. Bare line number, only accepted if the description corroborates it.
  const ref = (line.vendorItemRef ?? '').match(/^\D{0,6}0*(\d{1,3})\D{0,2}$/);
  if (ref && line.description) {
    const n = Number(ref[1]);
    const cand = items.find((i) => Number(i.id.slice(-3)) === n);
    if (cand) {
      const s = similarity(line.description, cand.description);
      if (s >= 0.3) return { itemId: cand.id, method: 'ref_number_with_description', score: s, note: null };
    }
  }

  // 4. Description only; must be a clear winner.
  if (line.description) {
    const ranked = items
      .map((i) => ({ i, s: similarity(line.description as string, i.description) }))
      .sort((a, b) => b.s - a.s);
    const best = ranked[0];
    const second = ranked[1];
    if (best && best.s >= 0.6 && (!second || best.s - second.s >= 0.15)) {
      return { itemId: best.i.id, method: 'description_match', score: best.s, note: null };
    }
    if (best && best.s >= 0.4) {
      return { itemId: null, method: 'none', score: best.s, note: `Closest RFx item was ${best.i.id} (similarity ${best.s.toFixed(2)}) but not clear enough to match automatically.` };
    }
  }
  return { itemId: null, method: 'none', score: 0, note: 'Could not match this line to any RFx item.' };
}
