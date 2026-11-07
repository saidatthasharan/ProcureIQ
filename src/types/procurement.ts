export type WorkspaceId =
  | 'overview'
  | 'rfx-workspace'
  | 'vendor-responses'
  | 'document-intelligence'
  | 'bid-comparison'
  | 'ai-analyst'
  | 'scenario-simulator'
  | 'award-recommendations'
  | 'reports-exports'
  | 'settings';

export type PackagingCategory =
  | '5-Ply Corrugated Boxes'
  | '3-Ply Corrugated Boxes'
  | 'Shipping Cartons'
  | 'Protective Packaging'
  | 'Corrugated Sheets'
  | 'Custom-Sized Cartons'
  | 'Packaging Rolls'
  | 'Die-Cut & Partition Inserts';

export type ApprovalStatus = 'ai_generated' | 'buyer_approved' | 'buyer_edited';

export interface LineItem {
  id: string; // e.g., PKG-HYD-001
  code: string;
  description: string;
  category: PackagingCategory;
  technicalSpec: string;
  burstingStrengthCS: string; // e.g., "Min 18 kg/cm²"
  gsmAndFlute: string; // e.g., "180/150/150/150/180 GSM, B+C Flute"
  dimensionsMm: string; // e.g., "600 x 400 x 400 mm"
  quantity: number;
  standardUom: 'Box' | 'Piece' | 'Sheet' | 'Roll' | 'Kg' | 'Set';
  targetDeliveryDays: number;
  qualityRequirement: string;
  expectedPriceMinInr: number;
  expectedPriceMaxInr: number;
  baselineUnitPriceInr: number; // Historical/budget baseline for savings math
  approvalStatus: ApprovalStatus;
}

export type DocumentFormat = 'Excel (.xlsx)' | 'PDF (.pdf)' | 'Word (.docx)' | 'Image (.jpg)' | 'Email (.eml)';

export type VendorProcessingStatus =
  | 'unextracted'
  | 'processing'
  | 'extracted_NeedsReview'
  | 'verified'
  | 'rejected';

export type ValidationBadgeType =
  | 'ai_generated'
  | 'source_verified'
  | 'buyer_verified'
  | 'low_confidence'
  | 'missing_info'
  | 'requires_clarification'
  | 'not_comparable'
  | 'quality_disqualified';

export interface Vendor {
  id: string; // V-APEX, V-GLOBAL, V-PRIMEPACK, V-SOUTHERN, V-ECOWRAP
  code: 'Vendor A' | 'Vendor B' | 'Vendor C' | 'Vendor D' | 'Vendor E';
  name: string;
  shortName: string;
  location: string;
  contactPerson: string;
  contactEmail: string;
  submissionTimestamp: string;
  documentFormat: DocumentFormat;
  documentFileName: string;
  documentSize: string;
  documentScenarioSummary: string;
  itemsQuotedCount: number;
  totalItemsCount: number;
  questionnaireStatus: 'Completed' | 'Completed (Failed Mandatory)' | 'Partial';
  processingStatus: VendorProcessingStatus;
  extractionConfidencePct: number;
  validationStatus: 'Pending Extraction' | 'Awaiting Buyer Review' | 'Verified' | 'Exceptions Found' | 'Clarification Requested' | 'Disqualified on Quality';
  deliveryLeadTimeDays: number;
  paymentTermsQuoted: string;
  freightPolicy: string;
  freightExtraPct: number;
  footnoteDiscountPct: number;
  gstPolicy: string;
  clarificationRequested?: boolean;
  clarificationNote?: string;
  // --- Added in Phase 2 ---
  /** False when the document did not state a lead time (deliveryLeadTimeDays is then not meaningful). */
  leadTimeStated?: boolean;
  /** Facts about the last extraction run for this vendor. */
  extractionRun?: {
    model: string;
    sha256: string;
    finishedAt: string;
    inputMode: string;
    /** Name found inside the document, so a wrong-file upload can be caught. */
    vendorNameInDocument: string | null;
    reviewFlags: string[];
    missingInformation: string[];
    counts: { total: number; firmPriced: number; priced: number; historicalReference: number; notQuoted: number; notMentioned: number; blocked: number; quotedWithoutPrice: number };
  };
}

export type QuoteValidationStatus =
  | 'verified'
  | 'buyer_verified'
  | 'low_confidence'
  | 'missing'
  | 'ambiguous_price'
  | 'unknown_unit'
  | 'historical_reference'
  | 'conflicting_values'
  | 'footnote_discount_applied'
  | 'unverified_visual'; // read from an image by AI; cannot be machine-checked against the source

/**
 * Three separate levels of trust. They must never be collapsed into one.
 *  ai_extracted     - the model read this value from the document.
 *  system_validated - deterministic checks passed (cited text found at the cited place, maths ran, no block reasons).
 *  buyer_verified   - a human looked at the source and confirmed it.
 */
export type TrustLevel = 'ai_extracted' | 'system_validated' | 'buyer_verified';

export interface SourceEvidence {
  documentName: string;
  kind: 'xlsx_cell' | 'pdf_text' | 'docx_paragraph' | 'email_line' | 'image_region';
  locator: string;
  page: number | null;
  snippet: string;
  boundingBox: { x: number; y: number; w: number; h: number } | null;
  check: 'verified_in_source' | 'not_found_in_source' | 'visual_unverified';
}

export interface VendorQuoteCell {
  itemId: string;
  vendorId: string;
  quoted: boolean;
  rawQuotedPrice: number | null;
  rawCurrency: 'INR' | 'USD';
  rawUom: string;
  conversionFactorToStandard: number; // e.g., 0.01 if quoted per 100 pcs
  conversionRuleId?: string;
  discountAppliedPct: number;
  freightAdjustmentPct: number;
  gstNormalisationAdjustmentPct: number;
  normalisedUnitPriceInr: number | null; // Null if missing or blocked by unverified unit/historical ambiguity
  provisionalUnitPriceInr: number | null; // Underlying figure if resolved
  confidencePct: number;
  sourceReference: string; // Cell, Page+Footnote, Paragraph, OCR Box, Email Line
  sourceSnippet: string;
  validationStatus: QuoteValidationStatus;
  buyerVerified: boolean;
  isComparable: boolean; // False if unknown_unit or historical_reference is unresolved
  conflictSecondaryValueInr?: number;
  exceptionNote?: string;
  // --- Added in Phase 2 (real extraction). Optional so older code keeps working. ---
  trust?: TrustLevel;
  evidence?: SourceEvidence[];
  /** GST percentage that is INSIDE the quoted price (0 when quoted ex-GST). */
  gstInclusivePct?: number;
  /** Plain-text conditions on any discount that was applied. */
  discountConditions?: string[];
  /** Reasons the price is blocked from comparison. Empty when usable. */
  blockReasons?: string[];
  /** Human-readable explanation of the unit conversion that was applied. */
  unitExplanation?: string;
  /** Assumptions the system made that the buyer should be aware of. */
  assumptions?: string[];
  /** Where this cell came from. 'seed_demo' cells are NOT extracted from any file. */
  origin?: 'gemini_extraction' | 'seed_demo';
  /** Price (INR per standard unit) a buyer typed in or selected during verification. Overrides the extracted value. */
  buyerConfirmedPriceInr?: number;
  /** What the system had before a buyer override, kept for the audit trail. */
  originalExtractedPriceInr?: number | null;
}

export type ExceptionType =
  | 'low_confidence'
  | 'missing_item'
  | 'ambiguous_price'
  | 'unknown_unit'
  | 'historical_reference'
  | 'conflicting_values'
  | 'footnote_discount';

export interface ExtractionException {
  id: string;
  vendorId: string;
  itemId: string;
  severity: 'Critical' | 'Warning' | 'Info';
  type: ExceptionType;
  title: string;
  description: string;
  extractedValueDisplay: string;
  sourceReference: string;
  sourceSnippet: string;
  confidencePct: number;
  status: 'Open' | 'Resolved (Buyer Verified)' | 'Clarification Requested' | 'Blocked from Comparison';
  recommendedAction: string;
  resolvedValueInr?: number;
}

export interface ConversionRule {
  id: string;
  vendorId: string;
  affectedItemIds: string[];
  category: 'Unit of Measure (UOM)' | 'Currency (FX)' | 'Footnote Discount' | 'Freight Normalisation' | 'Tax (GST) Normalisation' | 'Historical Price Reference';
  originalValueDisplay: string;
  originalUnitOrCurrency: string;
  standardisedValueDisplay: string;
  standardUnitOrCurrency: string;
  conversionFormula: string;
  conversionFactorOrRate: string;
  assumptionText: string;
  verificationStatus: 'Buyer Verified' | 'AI Suggested (Pending Verification)' | 'Blocked (Ambiguous)';
  blocksComparisonUntilVerified: boolean;
}

export interface QuestionnaireQuestion {
  id: string;
  number: number;
  category: 'Quality & Certifications' | 'Capacity & Operations' | 'Commercial & Compliance' | 'Sustainability & Delivery';
  questionText: string;
  mandatoryCriterion: boolean;
  weightPct: number;
  minimumRequirementDescription: string;
}

export interface VendorQuestionnaireResponse {
  /** 'sample_input' = demo data supplied with the project, NOT extracted from a vendor file. */
  origin?: 'sample_input' | 'extracted';
  questionId: string;
  vendorId: string;
  answerText: string;
  evidenceDocument: string;
  scoreOutOf100: number;
  passedMandatoryCheck: boolean;
  buyerVerified: boolean;
  failureReason?: string;
}

export type AwardAllocationStrategy =
  | 'cheapest_eligible_split'
  | 'single_vendor_best_overall'
  | 'single_vendor_custom'
  | 'dual_vendor_resilient_split'
  | 'fastest_delivery_priority';

export interface ScenarioConfig {
  id: string;
  name: string;
  strategy: AwardAllocationStrategy;
  singleTargetVendorId?: string;
  includedVendorIds: string[];
  enforceMandatoryQualityGate: boolean;
  includeUnverifiedAssumptions: boolean;
  usdToInrRate: number; // default 83.50
  applyGlobalFootnoteDiscount: boolean; // default true (4.5%)
  standardFreightOverridePct: number | null; // null uses vendor default
  maxLeadTimeDaysFilter: number; // default 21
  /** For the dual-vendor strategy: the two vendors to split between. Chosen automatically when omitted. */
  dualVendorIds?: string[];
}

export interface ScenarioItemAllocation {
  itemId: string;
  awardedVendorId: string | null;
  unitPriceInr: number | null;
  totalLineCostInr: number;
  baselineLineCostInr: number;
  savingsInr: number;
  isFallbackOrUnallocated: boolean;
  allocationReason: string;
}

export interface ScenarioVendorSummary {
  vendorId: string;
  vendorName: string;
  itemsAwarded: number;
  totalSpendInr: number;
  shareOfSpendPct: number;
  avgLeadTimeDays: number;
  qualityQualified: boolean;
  unresolvedExceptionsCount: number;
  /** False when the vendor's document did not state a lead time. */
  leadTimeStated?: boolean;
}

export interface ScenarioResult {
  config: ScenarioConfig;
  totalProcurementCostInr: number;
  totalBaselineCostInr: number;
  totalSavingsInr: number;
  savingsPct: number;
  awardedLineItemsCount: number;
  unallocatedLineItemsCount: number;
  eligibleVendorsCount: number;
  maxDeliveryDays: number;
  avgDeliveryDays: number;
  qualityComplianceStatus: '100% Compliant' | 'Non-Compliant Override Active';
  unresolvedExceptionsIncludedCount: number;
  vendorSummaries: ScenarioVendorSummary[];
  itemAllocations: ScenarioItemAllocation[];
}

export interface AnalystMessage {
  id: string;
  role: 'user' | 'assistant';
  timestamp: string;
  promptText: string;
  isDemoSimulation: boolean;
  headlineAnswer?: string;
  narrativeParagraphs?: string[];
  tableData?: {
    headers: string[];
    rows: (string | number)[][];
  };
  chartData?: {
    type: 'bar' | 'composed';
    title: string;
    xKey: string;
    yKey: string;
    secondaryKey?: string;
    data: Record<string, string | number>[];
  };
  calculationBreakdown?: string[];
  dataSources?: string[];
  assumptions?: string[];
  unresolvedRisks?: string[];
  // --- Added in Phase 2 (real tool-using analyst) ---
  /** Every table shown came from a tool result, never from the model's own text. */
  tables?: { title: string; headers: string[]; rows: (string | number)[][] }[];
  toolTrace?: { id: string; name: string; args: Record<string, unknown>; ok: boolean; error?: string }[];
  /** Figures in the answer that could not be found in any tool output. */
  ungroundedFigures?: string[];
  model?: string;
  error?: string;
}

// Phase 2 Real LLM Integration Contracts (Clean Architecture Separation)
export interface ILlmDocumentExtractor {
  mode: 'demo_deterministic' | 'live_gemini_api';
  extractVendorDocument(vendorId: string, fileFormat: DocumentFormat): Promise<{
    confidencePct: number;
    extractedQuotes: VendorQuoteCell[];
    exceptions: ExtractionException[];
  }>;
}

export interface ILlmProcurementAnalyst {
  mode: 'demo_deterministic' | 'live_gemini_api';
  queryProcurementDataset(question: string, contextSnapshot: unknown): Promise<AnalystMessage>;
}
