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
  validationStatus: 'Pending Extraction' | 'Verified' | 'Exceptions Found' | 'Clarification Requested' | 'Disqualified on Quality';
  deliveryLeadTimeDays: number;
  paymentTermsQuoted: string;
  freightPolicy: 'Included (DDP Hyderabad)' | 'Extra (+3.5% Ex-Works)' | 'Extra (+4.0% Freight)';
  freightExtraPct: number;
  footnoteDiscountPct: number;
  gstPolicy: '18% GST Extra (Standard)' | 'Inclusive of 18% GST';
  clarificationRequested?: boolean;
  clarificationNote?: string;
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
  | 'footnote_discount_applied';

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
  category: 'Unit of Measure (UOM)' | 'Currency (FX)' | 'Footnote Discount' | 'Freight Normalisation' | 'Tax (GST) Normalisation';
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
