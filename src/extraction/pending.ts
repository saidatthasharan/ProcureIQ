/**
 * The starting state before any vendor document has been processed.
 * Only the vendor registry (who was invited) is kept. Every commercial fact
 * (prices, terms, lead time, counts) stays empty until a real extraction fills it.
 */
import type { LineItem, Vendor, VendorQuoteCell } from '../types/procurement';

export function pendingVendor(v: Vendor): Vendor {
  return {
    ...v,
    submissionTimestamp: 'Awaiting document',
    documentFileName: '',
    documentSize: '',
    documentScenarioSummary: 'No document has been uploaded or extracted yet.',
    itemsQuotedCount: 0,
    totalItemsCount: 30,
    processingStatus: 'unextracted',
    extractionConfidencePct: 0,
    validationStatus: 'Pending Extraction',
    deliveryLeadTimeDays: 0,
    leadTimeStated: false,
    paymentTermsQuoted: 'Not stated',
    freightPolicy: 'Not stated',
    freightExtraPct: 0,
    footnoteDiscountPct: 0,
    gstPolicy: 'Not stated',
    clarificationRequested: false,
    clarificationNote: undefined,
    extractionRun: undefined,
  };
}

export function pendingCell(vendorId: string, item: LineItem): VendorQuoteCell {
  return {
    itemId: item.id, vendorId, quoted: false, rawQuotedPrice: null, rawCurrency: 'INR', rawUom: item.standardUom,
    conversionFactorToStandard: 1, discountAppliedPct: 0, freightAdjustmentPct: 0, gstNormalisationAdjustmentPct: 0,
    normalisedUnitPriceInr: null, provisionalUnitPriceInr: null, confidencePct: 0, sourceReference: '', sourceSnippet: '',
    validationStatus: 'missing', buyerVerified: false, isComparable: false, blockReasons: ['not_extracted'], evidence: [],
  };
}

export function pendingCells(vendors: Vendor[], items: LineItem[]): VendorQuoteCell[] {
  return vendors.flatMap((v) => items.map((i) => pendingCell(v.id, i)));
}
