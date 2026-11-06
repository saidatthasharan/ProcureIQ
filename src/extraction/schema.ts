/**
 * Extraction contract.
 *
 * This is the structure Gemini must return for every vendor document, and the
 * structure the server validates before anything reaches the UI.
 *
 * Design rules (these are what make the output auditable):
 *  - Every price line and every commercial term carries `evidence`: where in
 *    the original file the value came from, plus a verbatim snippet.
 *  - The model reports what the document SAYS. It never converts currency,
 *    units or tax. Those are done by deterministic code (normalise.ts).
 *  - "Not quoted" and "referenced a past price" are first-class statuses so
 *    a missing number is never silently turned into a price.
 */
import { z } from 'zod';

export const EVIDENCE_KINDS = [
  'xlsx_cell',
  'pdf_text',
  'docx_paragraph',
  'email_line',
  'image_region',
] as const;

export const EvidenceSchema = z.object({
  documentName: z.string().min(1),
  kind: z.enum(EVIDENCE_KINDS),
  /** Sheet!Cell, "p3", "para 14", "line 22", or a short description for images. */
  locator: z.string().min(1),
  page: z.number().int().positive().nullable(),
  /** Verbatim text copied from the source at that location. */
  snippet: z.string().min(1),
  /** Images only. Normalised 0..1 box reported by the model. Approximate. */
  boundingBox: z
    .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
    .nullable(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const LINE_STATUS = [
  'quoted', // vendor gave a price for this line
  'not_quoted', // vendor explicitly declined / omitted the line
  'historical_reference', // vendor pointed at a past price instead of a current one
  'ambiguous', // a price exists but the document does not make it usable
] as const;

export const TAX_BASIS = ['exclusive', 'inclusive', 'unspecified'] as const;
export const FREIGHT_BASIS = ['delivered', 'ex_works', 'extra_percent', 'unspecified'] as const;

export const ExtractedLineSchema = z.object({
  /** The item number / code exactly as the vendor wrote it. */
  vendorItemRef: z.string().nullable(),
  /** Item code from the RFx if the vendor used it (e.g. PKG-HYD-007). Null if not stated. */
  rfxItemId: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum(LINE_STATUS),
  /** Number as written. Do not convert. Null when no number is given. */
  unitPrice: z.number().nullable(),
  /** ISO code or symbol as written: INR, USD, Rs., $ */
  currency: z.string().nullable(),
  /** The unit the price is "per": "Box", "100 Pieces", "Metric Tonne", "Pallet Load". As written. */
  priceUnit: z.string().nullable(),
  quantity: z.number().nullable(),
  taxBasis: z.enum(TAX_BASIS),
  /** Line-specific freight statement if any (e.g. "ex-works"), else null. */
  freightNote: z.string().nullable(),
  /** Anything the buyer should know about this line (conflicts, handwriting, caveats). */
  notes: z.string().nullable(),
  /** 0..1, the model's own certainty about reading this line. Not a probability guarantee. */
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceSchema).min(1),
});
export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;

export const DiscountSchema = z.object({
  description: z.string(),
  percent: z.number().nullable(),
  /** Condition as written, e.g. "total award value above Rs 25,00,000". */
  condition: z.string().nullable(),
  /** Minimum award value in INR if the condition states one. */
  minAwardValueInr: z.number().nullable(),
  evidence: z.array(EvidenceSchema).min(1),
});
export type ExtractedDiscount = z.infer<typeof DiscountSchema>;

const TermText = z.object({
  value: z.string(),
  evidence: z.array(EvidenceSchema).min(1),
});

export const VendorTermsSchema = z.object({
  vendorName: TermText.nullable(),
  contactPerson: TermText.nullable(),
  contactEmail: TermText.nullable(),
  paymentTerms: TermText.nullable(),
  validity: TermText.nullable(),
  deliveryLeadTimeDays: z
    .object({ days: z.number(), asWritten: z.string(), evidence: z.array(EvidenceSchema).min(1) })
    .nullable(),
  freight: z
    .object({
      basis: z.enum(FREIGHT_BASIS),
      /** Percent added on top of line prices when basis is extra_percent / ex_works. */
      extraPercent: z.number().nullable(),
      asWritten: z.string(),
      evidence: z.array(EvidenceSchema).min(1),
    })
    .nullable(),
  tax: z
    .object({
      basis: z.enum(TAX_BASIS),
      ratePercent: z.number().nullable(),
      asWritten: z.string(),
      evidence: z.array(EvidenceSchema).min(1),
    })
    .nullable(),
  /** Default currency of the document when lines do not say. */
  documentCurrency: z.string().nullable(),
  discounts: z.array(DiscountSchema),
  otherTerms: z.array(TermText),
});
export type VendorTerms = z.infer<typeof VendorTermsSchema>;

export const VendorExtractionSchema = z.object({
  terms: VendorTermsSchema,
  lines: z.array(ExtractedLineSchema),
  /** Things the model could not find or could not read. Plain sentences. */
  missingInformation: z.array(z.string()),
  /** Sentences the model wants a human to look at. */
  reviewFlags: z.array(z.string()),
});
export type VendorExtractionRaw = z.infer<typeof VendorExtractionSchema>;

/** What the server returns for one uploaded document. */
export interface ExtractionRunMeta {
  documentName: string;
  documentFormat: 'xlsx' | 'pdf' | 'docx' | 'image' | 'eml';
  sha256: string;
  bytes: number;
  model: string;
  /** How the text/pixels reached the model. */
  inputMode: 'parsed_text' | 'native_pdf+parsed_text' | 'image';
  startedAt: string;
  finishedAt: string;
}

export type EvidenceCheck = 'verified_in_source' | 'not_found_in_source' | 'visual_unverified';

export interface CheckedEvidence extends Evidence {
  check: EvidenceCheck;
}

export interface VendorExtractionResult {
  meta: ExtractionRunMeta;
  raw: VendorExtractionRaw;
  /** Per-line evidence checks, same order as raw.lines. */
  lineEvidenceChecks: EvidenceCheck[][];
  /** Document-level problems found by deterministic validation. */
  validationIssues: string[];
}
