/**
 * Turns a validated vendor extraction into the objects the UI and the
 * analyst tools use: quote cells, exceptions, conversion rules and a vendor
 * summary. Everything here is computed from the extraction. Nothing is read
 * from seed data.
 */
import type {
  ConversionRule,
  ExtractionException,
  ExceptionType,
  LineItem,
  QuoteValidationStatus,
  SourceEvidence,
  Vendor,
  VendorQuoteCell,
} from '../types/procurement';
import type { ExtractedLine, VendorExtractionResult, EvidenceCheck } from './schema';
import {
  DEFAULT_SETTINGS,
  matchLineToItem,
  normaliseLine,
  similarity,
  type NormalisationSettings,
  type NormalisedLine,
} from './normalise';

export interface DeriveOptions {
  settings: NormalisationSettings;
  /** Lines with model confidence below this (0..1) are not comparable until a buyer verifies them. */
  minConfidence: number;
}

export const DEFAULT_DERIVE_OPTIONS: DeriveOptions = { settings: DEFAULT_SETTINGS, minConfidence: 0.85 };

export interface DerivedVendorData {
  cells: VendorQuoteCell[];
  exceptions: ExtractionException[];
  rules: ConversionRule[];
  vendorPatch: Partial<Vendor>;
  /** Lines the model returned that could not be matched to any RFx item. */
  unmatchedLines: { line: ExtractedLine; note: string | null }[];
}

interface Candidate {
  line: ExtractedLine;
  lineIndex: number;
  checks: EvidenceCheck[];
  norm: NormalisedLine;
  matchMethod: string;
}

const money = (n: number | null | undefined) =>
  n == null ? 'n/a' : `INR ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toEvidence(line: ExtractedLine, checks: EvidenceCheck[]): SourceEvidence[] {
  return line.evidence.map((e, i) => ({ ...e, check: checks[i] ?? 'not_found_in_source' }));
}

function refString(ev: SourceEvidence[]): string {
  return ev.map((e) => (e.page ? `${e.locator} (p${e.page})` : e.locator)).join('; ');
}

function shortCode(vendorId: string): string {
  return vendorId.replace(/^V-/, '').slice(0, 4).toUpperCase();
}

export function deriveVendorData(
  vendor: Pick<Vendor, 'id' | 'name' | 'shortName'>,
  result: VendorExtractionResult,
  items: LineItem[],
  options: DeriveOptions = DEFAULT_DERIVE_OPTIONS
): DerivedVendorData {
  const { terms, lines } = result.raw;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const unmatchedLines: DerivedVendorData['unmatchedLines'] = [];
  const byItem = new Map<string, Candidate[]>();
  const isImage = result.meta.documentFormat === 'image';

  lines.forEach((line, lineIndex) => {
    const m = matchLineToItem(line, items);
    if (!m.itemId) {
      unmatchedLines.push({ line, note: m.note });
      return;
    }
    const item = itemById.get(m.itemId)!;
    const norm = normaliseLine(line, terms, item, options.settings);
    const list = byItem.get(m.itemId) ?? [];
    list.push({ line, lineIndex, checks: result.lineEvidenceChecks[lineIndex] ?? [], norm, matchMethod: m.method });
    byItem.set(m.itemId, list);
  });

  const cells: VendorQuoteCell[] = [];
  const exceptions: ExtractionException[] = [];
  const ruleIdFor = (kind: string, key: string) => `RULE-${shortCode(vendor.id)}-${kind}-${key}`;
  const uomKeys = new Map<string, { items: string[]; text: string; factor: number }>();
  const blockedUnitKeys = new Map<string, { items: string[]; reason: string; unit: string }>();
  const fxItems: string[] = [];
  const gstItems: string[] = [];
  const freightItems: string[] = [];
  const historicalItems: string[] = [];
  const discountItems: string[] = [];

  const addException = (e: Omit<ExtractionException, 'id' | 'status' | 'vendorId'> & { suffix: string }) => {
    const { suffix, ...rest } = e;
    exceptions.push({
      ...rest,
      id: `EXC-${shortCode(vendor.id)}-${e.itemId.slice(-3)}-${suffix}`,
      vendorId: vendor.id,
      status: 'Open',
    });
  };

  for (const item of items) {
    const cands = byItem.get(item.id) ?? [];

    /* -------- nothing in the document for this item -------- */
    if (cands.length === 0) {
      cells.push({
        itemId: item.id, vendorId: vendor.id, quoted: false, rawQuotedPrice: null, rawCurrency: 'INR',
        rawUom: item.standardUom, conversionFactorToStandard: 1, discountAppliedPct: 0, freightAdjustmentPct: 0,
        gstNormalisationAdjustmentPct: 0, normalisedUnitPriceInr: null, provisionalUnitPriceInr: null,
        confidencePct: 0, sourceReference: 'Not found in document', sourceSnippet: '',
        validationStatus: 'missing', buyerVerified: false, isComparable: false,
        exceptionNote: 'The document does not mention this item.', trust: 'ai_extracted',
        evidence: [], blockReasons: ['not_mentioned'], origin: 'gemini_extraction',
      });
      addException({
        suffix: 'MISS', itemId: item.id, severity: 'Warning', type: 'missing_item',
        title: 'Item not mentioned in the vendor document',
        description: 'Neither a price nor an explicit "not quoted" statement was found for this item. The vendor may have omitted it by mistake.',
        extractedValueDisplay: 'No value', sourceReference: 'Whole document', sourceSnippet: '', confidencePct: 0,
        recommendedAction: 'Ask the vendor whether this item is intentionally not quoted.',
      });
      continue;
    }

    /* -------- one or more mentions -------- */
    const primary = cands[0];
    const priced = cands.filter((c) => c.norm.priceInr != null || c.norm.provisionalPriceInr != null);
    let conflict = false;
    if (priced.length > 1) {
      const first = priced[0].norm.priceInr ?? priced[0].norm.provisionalPriceInr;
      conflict = priced.some((c) => Math.abs((c.norm.priceInr ?? c.norm.provisionalPriceInr ?? 0) - (first ?? 0)) > 0.005);
    }
    const pick = conflict ? priced[0] : (cands.find((c) => c.norm.priceInr != null) ?? primary);
    const { line, norm, checks } = pick;
    const evidence = cands.flatMap((c) => toEvidence(c.line, c.checks));
    const evidenceMissing = pick.checks.some((c) => c === 'not_found_in_source');
    const lowConf = line.confidence < options.minConfidence;

    const notQuoted = line.status === 'not_quoted';
    const quoted = !notQuoted;
    const blockReasons: string[] = [...norm.blockReasons];
    if (conflict) blockReasons.push('conflicting_values');
    if (evidenceMissing) blockReasons.push('evidence_not_found');
    if (lowConf && !notQuoted) blockReasons.push('low_confidence');

    const usable = norm.priceInr != null && !conflict && !evidenceMissing && !lowConf;

    let status: QuoteValidationStatus;
    if (notQuoted) status = 'missing';
    else if (line.status === 'historical_reference') status = 'historical_reference';
    else if (conflict) status = 'conflicting_values';
    else if (norm.blockReasons.includes('unknown_unit')) status = 'unknown_unit';
    else if (evidenceMissing || lowConf) status = 'low_confidence';
    else if (norm.blockReasons.length > 0) status = 'ambiguous_price';
    else if (isImage) status = 'unverified_visual';
    else if (norm.discountConditions.length > 0) status = 'footnote_discount_applied';
    else status = 'verified';

    // Trust: only deterministic checks can lift a value above 'ai_extracted'.
    const systemValidated = usable && !isImage && pick.checks.length > 0 && pick.checks.every((c) => c === 'verified_in_source');

    const comp = norm.components;
    const second = conflict ? priced[1] : undefined;
    const secondPrice = second ? (second.norm.priceInr ?? second.norm.provisionalPriceInr ?? undefined) : undefined;

    cells.push({
      itemId: item.id,
      vendorId: vendor.id,
      quoted,
      rawQuotedPrice: line.unitPrice,
      rawCurrency: comp?.currency ?? (line.currency?.toUpperCase().includes('USD') || line.currency === '$' ? 'USD' : 'INR'),
      rawUom: line.priceUnit ?? item.standardUom,
      conversionFactorToStandard: comp?.uomFactor ?? 1,
      discountAppliedPct: comp?.discountPct ?? 0,
      freightAdjustmentPct: comp?.freightPct ?? 0,
      gstNormalisationAdjustmentPct: comp && comp.gstInclusivePct > 0 ? Math.round((1 / (1 + comp.gstInclusivePct / 100) - 1) * 10000) / 100 : 0,
      gstInclusivePct: comp?.gstInclusivePct ?? 0,
      normalisedUnitPriceInr: usable ? norm.priceInr : null,
      provisionalUnitPriceInr: norm.priceInr ?? norm.provisionalPriceInr,
      confidencePct: Math.round(line.confidence * 1000) / 10,
      sourceReference: refString(evidence),
      sourceSnippet: evidence[0]?.snippet ?? '',
      validationStatus: status,
      buyerVerified: false, // Only a human action in the UI may set this.
      isComparable: usable,
      conflictSecondaryValueInr: secondPrice,
      exceptionNote: norm.blockDetails[0] ?? (conflict ? 'The document gives two different prices for this item.' : line.notes ?? undefined),
      trust: systemValidated ? 'system_validated' : 'ai_extracted',
      evidence,
      discountConditions: norm.discountConditions,
      blockReasons,
      unitExplanation: norm.unitExplanation ?? undefined,
      assumptions: norm.assumptions,
      origin: 'gemini_extraction',
    });

    /* -------- bookkeeping for conversion rules -------- */
    if (comp) {
      if (comp.uomFactor !== 1 && norm.unitExplanation) {
        const k = line.priceUnit ?? '';
        const e = uomKeys.get(k) ?? { items: [], text: norm.unitExplanation, factor: comp.uomFactor };
        e.items.push(item.id);
        uomKeys.set(k, e);
      }
      if (comp.currency === 'USD') fxItems.push(item.id);
      if (comp.gstInclusivePct > 0) gstItems.push(item.id);
      if (comp.freightPct > 0) freightItems.push(item.id);
      if (comp.discountPct > 0) discountItems.push(item.id);
    }
    if (norm.blockReasons.includes('unknown_unit')) {
      const k = line.priceUnit ?? '(none)';
      const e = blockedUnitKeys.get(k) ?? { items: [], reason: norm.blockDetails.find((d) => d.includes('unit') || d.includes('container')) ?? 'Unit not resolvable.', unit: k };
      e.items.push(item.id);
      blockedUnitKeys.set(k, e);
    }
    if (line.status === 'historical_reference') historicalItems.push(item.id);

    /* -------- exceptions (one primary reason per cell, so the queue stays readable) -------- */
    const base = {
      itemId: item.id,
      sourceReference: refString(evidence),
      sourceSnippet: evidence[0]?.snippet ?? '',
      confidencePct: Math.round(line.confidence * 1000) / 10,
    };
    const shown = line.unitPrice != null ? `${line.currency ?? ''} ${line.unitPrice} per ${line.priceUnit ?? '?'}`.trim() : 'No numeric price';
    const push = (suffix: string, severity: ExtractionException['severity'], type: ExceptionType, title: string, description: string, action: string) =>
      addException({ ...base, suffix, severity, type, title, description, recommendedAction: action, extractedValueDisplay: shown });

    if (notQuoted) {
      // Explicit "not quoted" is information, not an error. No exception.
    } else if (line.status === 'historical_reference') {
      push('HIST', 'Critical', 'historical_reference', 'Vendor refers to a past price',
        'The vendor points to a previous contract or order instead of stating a current price. A past price is not a quotation.',
        'Request a written, current-year price from the vendor. Do not use the historical figure.');
    } else if (conflict) {
      push('CONF', 'Critical', 'conflicting_values', 'Document gives two different prices',
        `Two places in the document give different prices for this item (${money(priced[0].norm.priceInr ?? priced[0].norm.provisionalPriceInr)} vs ${money(secondPrice)} after normalisation).`,
        'Check both source locations and confirm the intended price with the vendor.');
    } else if (norm.blockReasons.includes('unknown_unit')) {
      push('UNIT', 'Critical', 'unknown_unit', 'Price unit cannot be resolved', norm.blockDetails.join(' '),
        'Ask the vendor for the quantity covered by the stated unit. No price has been guessed.');
    } else if (evidenceMissing) {
      push('EVID', 'Warning', 'low_confidence', 'Cited text not found at the cited location',
        'The extraction cited a snippet that could not be found in the source document at that location. The value may be misread.',
        'Open the source document and confirm this value by eye.');
    } else if (lowConf) {
      push('CONF', 'Warning', 'low_confidence', 'Low extraction confidence',
        `The model reported ${Math.round(line.confidence * 100)}% certainty, below the ${Math.round(options.minConfidence * 100)}% threshold.${line.notes ? ' Note: ' + line.notes : ''}`,
        'Compare the value against the source image or text and confirm it.');
    } else if (norm.blockReasons.length > 0) {
      push('AMBG', 'Warning', 'ambiguous_price', 'Price cannot be finalised', norm.blockDetails.join(' '),
        'Confirm the missing commercial term with the vendor.');
    } else if (norm.discountConditions.length > 0) {
      push('DISC', 'Info', 'footnote_discount', 'Conditional discount applied',
        `A discount was applied that depends on a condition: ${norm.discountConditions.join('; ')}. It only holds if that condition is met.`,
        'Confirm the award value meets the condition before relying on the discounted price.');
    }
  }

  /* -------- conversion rules -------- */
  const rules: ConversionRule[] = [];
  const mk = (r: Omit<ConversionRule, 'vendorId'>) => rules.push({ ...r, vendorId: vendor.id });

  uomKeys.forEach((e, unit) =>
    mk({
      id: ruleIdFor('UOM', unit.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase()),
      affectedItemIds: e.items, category: 'Unit of Measure (UOM)',
      originalValueDisplay: `Price per ${unit}`, originalUnitOrCurrency: unit,
      standardisedValueDisplay: 'Price per RFx standard unit', standardUnitOrCurrency: 'RFx standard unit',
      conversionFormula: 'standard price = quoted price x factor', conversionFactorOrRate: String(e.factor),
      assumptionText: e.text, verificationStatus: 'AI Suggested (Pending Verification)', blocksComparisonUntilVerified: false,
    })
  );
  blockedUnitKeys.forEach((e, unit) =>
    mk({
      id: ruleIdFor('UOMX', unit.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'NONE'),
      affectedItemIds: e.items, category: 'Unit of Measure (UOM)',
      originalValueDisplay: `Price per ${unit}`, originalUnitOrCurrency: unit,
      standardisedValueDisplay: 'Cannot be standardised', standardUnitOrCurrency: 'RFx standard unit',
      conversionFormula: 'None - unit quantity unknown', conversionFactorOrRate: 'Unresolved',
      assumptionText: e.reason, verificationStatus: 'Blocked (Ambiguous)', blocksComparisonUntilVerified: true,
    })
  );
  if (fxItems.length)
    mk({
      id: ruleIdFor('FX', 'USD'), affectedItemIds: fxItems, category: 'Currency (FX)',
      originalValueDisplay: 'Price in USD', originalUnitOrCurrency: 'USD', standardisedValueDisplay: 'Price in INR',
      standardUnitOrCurrency: 'INR', conversionFormula: 'INR price = USD price x reference rate',
      conversionFactorOrRate: String(options.settings.usdToInrRate),
      assumptionText: `Converted at the reference rate of ${options.settings.usdToInrRate} INR per USD set in Settings. The vendor document does not set a rate.`,
      verificationStatus: 'AI Suggested (Pending Verification)', blocksComparisonUntilVerified: false,
    });
  if (gstItems.length)
    mk({
      id: ruleIdFor('GST', 'INCL'), affectedItemIds: gstItems, category: 'Tax (GST) Normalisation',
      originalValueDisplay: 'Price including GST', originalUnitOrCurrency: 'INR incl. GST',
      standardisedValueDisplay: 'Price excluding GST', standardUnitOrCurrency: 'INR ex-GST',
      conversionFormula: 'ex-GST price = quoted price / (1 + GST rate)',
      conversionFactorOrRate: `${terms.tax?.ratePercent ?? options.settings.defaultGstRatePct}%`,
      assumptionText: terms.tax?.asWritten ?? 'GST-inclusive pricing.', verificationStatus: 'AI Suggested (Pending Verification)',
      blocksComparisonUntilVerified: false,
    });
  if (freightItems.length)
    mk({
      id: ruleIdFor('FRT', 'EXTRA'), affectedItemIds: freightItems, category: 'Freight Normalisation',
      originalValueDisplay: 'Price before freight', originalUnitOrCurrency: 'INR ex-freight',
      standardisedValueDisplay: 'Delivered price', standardUnitOrCurrency: 'INR delivered',
      conversionFormula: 'delivered price = quoted price x (1 + freight %)', conversionFactorOrRate: `${terms.freight?.extraPercent ?? '?'}%`,
      assumptionText: terms.freight?.asWritten ?? 'Freight charged extra.', verificationStatus: 'AI Suggested (Pending Verification)',
      blocksComparisonUntilVerified: false,
    });
  terms.discounts.forEach((d, i) => {
    if (d.percent == null) return;
    mk({
      id: ruleIdFor('DSC', String(i + 1)), affectedItemIds: discountItems, category: 'Footnote Discount',
      originalValueDisplay: d.description, originalUnitOrCurrency: 'Gross price',
      standardisedValueDisplay: `Gross price less ${d.percent}%`, standardUnitOrCurrency: 'Net price',
      conversionFormula: 'net price = gross price x (1 - discount %)', conversionFactorOrRate: `${d.percent}%`,
      assumptionText: d.condition ? `Conditional: ${d.condition}` : 'Unconditional discount stated in the document.',
      verificationStatus: 'AI Suggested (Pending Verification)', blocksComparisonUntilVerified: false,
    });
  });
  if (historicalItems.length)
    mk({
      id: ruleIdFor('HIST', 'REF'), affectedItemIds: historicalItems, category: 'Historical Price Reference',
      originalValueDisplay: 'Reference to a past price', originalUnitOrCurrency: 'Past contract',
      standardisedValueDisplay: 'No current price', standardUnitOrCurrency: 'n/a',
      conversionFormula: 'None - a past price is not a current quotation', conversionFactorOrRate: 'Not applicable',
      assumptionText: 'Excluded from comparison until the vendor confirms a current price in writing.',
      verificationStatus: 'Blocked (Ambiguous)', blocksComparisonUntilVerified: true,
    });

  // Attach the most significant rule to each cell.
  const ruleOf = (itemId: string): string | undefined => {
    const hit = (cat: ConversionRule['category']) => rules.find((r) => r.category === cat && r.affectedItemIds.includes(itemId))?.id;
    return (
      rules.find((r) => r.blocksComparisonUntilVerified && r.affectedItemIds.includes(itemId))?.id ??
      hit('Unit of Measure (UOM)') ?? hit('Currency (FX)') ?? hit('Tax (GST) Normalisation') ?? hit('Freight Normalisation') ?? hit('Footnote Discount')
    );
  };
  cells.forEach((c) => (c.conversionRuleId = ruleOf(c.itemId)));

  /* -------- vendor summary, computed from the cells -------- */
  const total = items.length;
  const statusOf = (c: VendorQuoteCell) => c.validationStatus;
  const notMentioned = cells.filter((c) => c.blockReasons?.includes('not_mentioned')).length;
  const explicitNotQuoted = cells.filter((c) => !c.quoted && !c.blockReasons?.includes('not_mentioned')).length;
  const historical = cells.filter((c) => statusOf(c) === 'historical_reference').length;
  const priced = cells.filter((c) => c.quoted && c.rawQuotedPrice != null).length;
  // Responded in some way but gave no number and is not a past-price reference (e.g. 'ambiguous').
  const quotedWithoutPrice = cells.filter((c) => c.quoted && c.rawQuotedPrice == null && statusOf(c) !== 'historical_reference').length;
  const firm = cells.filter((c) => c.isComparable).length;
  const blocked = cells.filter((c) => c.quoted && !c.isComparable).length;
  const confs = cells.filter((c) => c.quoted).map((c) => c.confidencePct);
  const avgConf = confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10) / 10 : 0;

  const vendorNameInDoc = terms.vendorName?.value ?? null;
  const flags = [...result.raw.reviewFlags, ...result.validationIssues];
  if (vendorNameInDoc && similarity(vendorNameInDoc, vendor.name) < 0.3 && similarity(vendorNameInDoc, vendor.shortName) < 0.3) {
    flags.unshift(`The document names "${vendorNameInDoc}" but was uploaded against "${vendor.name}". Check that the right file was attached.`);
  }
  if (unmatchedLines.length) {
    flags.push(`${unmatchedLines.length} line(s) in the document could not be matched to any RFx item and were not used.`);
  }

  const freight = terms.freight;
  const tax = terms.tax;
  const maxDisc = terms.discounts.reduce((m, d) => Math.max(m, d.percent ?? 0), 0);

  const vendorPatch: Partial<Vendor> = {
    itemsQuotedCount: priced,
    totalItemsCount: total,
    extractionConfidencePct: avgConf,
    deliveryLeadTimeDays: terms.deliveryLeadTimeDays?.days ?? 0,
    leadTimeStated: terms.deliveryLeadTimeDays != null,
    paymentTermsQuoted: terms.paymentTerms?.value ?? 'Not stated',
    freightPolicy: freight ? freight.asWritten : 'Not stated',
    freightExtraPct: freight && (freight.basis === 'ex_works' || freight.basis === 'extra_percent') ? freight.extraPercent ?? 0 : 0,
    footnoteDiscountPct: maxDisc,
    gstPolicy: tax ? tax.asWritten : 'Not stated',
    documentScenarioSummary:
      `${priced} of ${total} items have a price` +
      (blocked ? ` (${blocked} not usable yet)` : '') +
      `; ${historical} refer to past prices; ${explicitNotQuoted} explicitly not quoted; ${notMentioned} not mentioned.`,
    // 'Verified' is reserved for a human buyer action; extraction can never set it.
    validationStatus: exceptions.some((e) => e.severity !== 'Info') || flags.length ? 'Exceptions Found' : 'Awaiting Buyer Review',
    processingStatus: 'extracted_NeedsReview',
    extractionRun: {
      model: result.meta.model,
      sha256: result.meta.sha256,
      finishedAt: result.meta.finishedAt,
      inputMode: result.meta.inputMode,
      vendorNameInDocument: vendorNameInDoc,
      reviewFlags: flags,
      missingInformation: result.raw.missingInformation,
      counts: { total, firmPriced: firm, priced, historicalReference: historical, notQuoted: explicitNotQuoted, notMentioned, blocked, quotedWithoutPrice },
    },
  };

  return { cells, exceptions, rules, vendorPatch, unmatchedLines };
}
