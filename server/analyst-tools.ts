/**
 * Controlled tools the AI analyst may call. Every number comes from the same
 * deterministic engine the rest of the app uses. The model never does arithmetic
 * on prices and cannot read anything except what these tools return.
 */
import { z } from 'zod';
import type {
  ExtractionException, LineItem, QuestionnaireQuestion, ScenarioConfig, Vendor, VendorQuestionnaireResponse, VendorQuoteCell,
} from '../src/types/procurement';
import {
  calculateVendorQualification, evaluateScenario, formatInr, formatLakhs, getEffectiveCellPriceInr,
} from '../src/services/procurementEngine';
import type { ToolDeclaration } from './model';

export interface AnalystState {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  exceptions: ExtractionException[];
  usdToInrRate: number;
}

export interface ToolTable { title: string; headers: string[]; rows: (string | number)[][] }
export interface ToolResult {
  /** Machine-readable result returned to the model. */
  data: Record<string, unknown>;
  /** Optional table the buyer can be shown (referenced by the model with its table id). */
  table?: ToolTable;
}

const STRATEGIES = ['cheapest_eligible_split', 'single_vendor_custom', 'dual_vendor_resilient_split', 'fastest_delivery_priority', 'single_vendor_best_overall'] as const;

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required });

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  { name: 'get_project_overview', description: 'Project-level facts: number of line items, suppliers and their processing status, baseline spend, open extraction exceptions, how many quote cells are usable, buyer-verified or blocked. Call this first when unsure what data exists.', parameters: obj({}) },
  { name: 'get_vendor_summary', description: 'Per-supplier facts from the extracted documents: items with a usable price, items blocked, items not quoted, payment terms, freight, lead time (and whether it was stated), discounts, mandatory-question outcome. Optionally for one supplier.', parameters: obj({ vendorId: { type: 'string', description: 'e.g. V-APEX. Omit for all suppliers.' } }) },
  { name: 'get_line_item_comparison', description: 'Normalised INR price per RFx unit for each supplier, per line item, with the cheapest comparable supplier and a flag for prices that are unverified assumptions. Use for "who is cheapest on X", cheapest per item, missing quotes.', parameters: obj({ itemIds: { type: 'array', items: { type: 'string' }, description: 'e.g. ["PKG-HYD-001"]. Omit for all items.' }, onlyWithMissingQuotes: { type: 'boolean' } }) },
  { name: 'get_questionnaire_outcomes', description: 'Mandatory-question pass/fail and weighted score per supplier. NOTE the answers are sample inputs supplied with the project, not extracted from vendor files, and are not buyer-verified.', parameters: obj({ vendorId: { type: 'string' } }) },
  { name: 'get_extraction_exceptions', description: 'Open or resolved extraction exceptions (low confidence, historical references, unknown units, conflicts...). Filter by supplier or status.', parameters: obj({ vendorId: { type: 'string' }, status: { type: 'string', enum: ['open', 'resolved', 'all'] } }) },
  {
    name: 'evaluate_award_scenario',
    description: 'Run the deterministic award engine for a scenario and return total cost, baseline, savings, per-supplier allocation and per-line allocation. Use for single-vendor vs split comparisons and savings. Call it once per scenario you want to compare. Lines with no usable price are reported as unallocated (not priced).',
    parameters: obj({
      strategy: { type: 'string', enum: [...STRATEGIES] },
      vendorIds: { type: 'array', items: { type: 'string' }, description: 'Suppliers allowed in the scenario. Omit for all.' },
      singleVendorId: { type: 'string', description: 'Required for single_vendor_custom.' },
      enforceMandatoryQuestions: { type: 'boolean', description: 'Default true.' },
      includeUnverifiedAssumptions: { type: 'boolean', description: 'Default false.' },
      applyConditionalDiscounts: { type: 'boolean', description: 'Default true.' },
      maxLeadTimeDays: { type: 'number', description: 'Default 21.' },
    }, ['strategy']),
  },
  { name: 'get_cell_evidence', description: 'Everything known about one supplier price for one item: the quoted value and unit, the conversion formula and factors, assumptions, block reasons, trust level, and the text cited from the source document.', parameters: obj({ itemId: { type: 'string' }, vendorId: { type: 'string' } }, ['itemId', 'vendorId']) },
];

const r2 = (n: number | null | undefined) => (n == null ? null : Number(n.toFixed(2)));
const short = (state: AnalystState, id: string | null | undefined) => state.vendors.find((v) => v.id === id)?.shortName ?? id ?? '—';

function cellStatus(c: VendorQuoteCell | undefined, price: number | null): string {
  if (!c) return 'no data';
  if (price !== null) return c.buyerVerified ? 'buyer verified' : c.trust === 'system_validated' ? 'system validated' : 'AI extracted (unverified)';
  if (!c.quoted && (c.blockReasons ?? []).includes('not_quoted')) return 'declined';
  if (!c.quoted) return 'not quoted';
  return `blocked: ${(c.blockReasons ?? [c.validationStatus]).join(', ')}`;
}

function vendorOf(state: AnalystState, id?: string) {
  if (!id) return undefined;
  const v = state.vendors.find((x) => x.id === id);
  if (!v) throw new ToolError(`Unknown vendorId "${id}". Valid ids: ${state.vendors.map((x) => x.id).join(', ')}.`);
  return v;
}
export class ToolError extends Error {}

export function runTool(name: string, rawArgs: Record<string, unknown>, state: AnalystState): ToolResult {
  switch (name) {
    case 'get_project_overview': {
      const cells = state.quoteCells;
      const usable = cells.filter((c) => c.isComparable && c.normalisedUnitPriceInr != null);
      const baseline = state.lineItems.reduce((s, i) => s + i.quantity * i.baselineUnitPriceInr, 0);
      const processed = state.vendors.filter((v) => v.processingStatus !== 'unextracted');
      return {
        data: {
          lineItems: state.lineItems.length,
          baselineSpend: { inr: r2(baseline), display: formatInr(baseline), lakhs: formatLakhs(baseline) },
          suppliers: state.vendors.map((v) => ({ id: v.id, name: v.name, processingStatus: v.processingStatus, validationStatus: v.validationStatus })),
          suppliersProcessed: processed.length,
          cells: { total: cells.length, usable: usable.length, buyerVerified: cells.filter((c) => c.buyerVerified).length, aiExtractedUnverified: usable.filter((c) => !c.buyerVerified).length },
          openExceptions: state.exceptions.filter((e) => e.status !== 'Resolved (Buyer Verified)').length,
          note: processed.length === 0 ? 'No vendor document has been processed yet, so there are no prices to analyse.' : undefined,
        },
      };
    }

    case 'get_vendor_summary': {
      const only = vendorOf(state, z.object({ vendorId: z.string().optional() }).parse(rawArgs).vendorId);
      const list = only ? [only] : state.vendors;
      const rows = list.map((v) => {
        const cells = state.quoteCells.filter((c) => c.vendorId === v.id);
        const priced = cells.filter((c) => getEffectiveCellPriceInr(c, v).priceInr !== null);
        const q = calculateVendorQualification(v.id, state.questions, state.responses);
        return {
          id: v.id, name: v.name, processingStatus: v.processingStatus, document: v.documentFileName || null,
          itemsWithUsablePrice: priced.length,
          itemsBlocked: cells.filter((c) => c.quoted && getEffectiveCellPriceInr(c, v).priceInr === null).length,
          itemsNotQuoted: cells.filter((c) => !c.quoted).length,
          paymentTerms: v.paymentTermsQuoted, freightPolicy: v.freightPolicy, freightExtraPct: v.freightExtraPct,
          leadTimeDays: v.leadTimeStated === false ? 'not stated' : v.deliveryLeadTimeDays,
          conditionalDiscountPct: v.footnoteDiscountPct, gstPolicy: v.gstPolicy,
          mandatoryQuestionsPassed: q.passedAllMandatory, weightedScore: q.weightedScore,
          failedMandatory: q.failedMandatoryQuestions.map((f) => `${f.question.id}: ${f.reason}`),
          openExceptions: state.exceptions.filter((e) => e.vendorId === v.id && e.status !== 'Resolved (Buyer Verified)').length,
        };
      });
      return {
        data: { vendors: rows, questionnaireNote: 'Questionnaire answers are sample inputs, not extracted from vendor files, and not buyer-verified.' },
        table: { title: 'Supplier summary', headers: ['Supplier', 'Usable prices', 'Blocked', 'Not quoted', 'Lead time (days)', 'Mandatory questions'], rows: rows.map((r) => [r.name, r.itemsWithUsablePrice, r.itemsBlocked, r.itemsNotQuoted, String(r.leadTimeDays), r.mandatoryQuestionsPassed ? 'pass' : 'FAIL']) },
      };
    }

    case 'get_line_item_comparison': {
      const a = z.object({ itemIds: z.array(z.string()).optional(), onlyWithMissingQuotes: z.boolean().optional() }).parse(rawArgs);
      const items = state.lineItems.filter((i) => !a.itemIds || a.itemIds.includes(i.id));
      if (a.itemIds) {
        const bad = a.itemIds.filter((id) => !state.lineItems.some((i) => i.id === id));
        if (bad.length) throw new ToolError(`Unknown item id(s): ${bad.join(', ')}. Ids look like PKG-HYD-001.`);
      }
      const out = items.map((item) => {
        const per = state.vendors.map((v) => {
          const c = state.quoteCells.find((x) => x.itemId === item.id && x.vendorId === v.id);
          const eff = c ? getEffectiveCellPriceInr(c, v) : { priceInr: null, hasUnresolvedAssumption: false };
          return { vendorId: v.id, supplier: v.shortName, priceInr: eff.priceInr, status: cellStatus(c, eff.priceInr), unresolvedAssumption: eff.hasUnresolvedAssumption };
        });
        const priced = per.filter((p) => p.priceInr !== null) as (typeof per[number] & { priceInr: number })[];
        const best = priced.length ? priced.reduce((m, p) => (p.priceInr < m.priceInr ? p : m)) : null;
        return { itemId: item.id, code: item.code, description: item.description, unit: item.standardUom, quantity: item.quantity, baselineUnitPriceInr: item.baselineUnitPriceInr, suppliers: per, cheapest: best ? { supplier: best.supplier, priceInr: best.priceInr, unverified: best.unresolvedAssumption } : null, suppliersWithoutUsablePrice: per.filter((p) => p.priceInr === null).length };
      }).filter((x) => !a.onlyWithMissingQuotes || x.suppliersWithoutUsablePrice > 0);
      return {
        data: { items: out },
        table: {
          title: 'Line-item comparison (INR per unit)',
          headers: ['Item', 'Qty', 'Baseline', ...state.vendors.map((v) => v.shortName), 'Cheapest'],
          rows: out.map((o) => [o.itemId, o.quantity, o.baselineUnitPriceInr, ...o.suppliers.map((s) => (s.priceInr === null ? `— (${s.status})` : `${s.priceInr}${s.unresolvedAssumption ? ' *' : ''}`)), o.cheapest ? `${o.cheapest.supplier} ${o.cheapest.priceInr}` : 'none']),
        },
      };
    }

    case 'get_questionnaire_outcomes': {
      const only = vendorOf(state, z.object({ vendorId: z.string().optional() }).parse(rawArgs).vendorId);
      const list = only ? [only] : state.vendors;
      const rows = list.map((v) => {
        const q = calculateVendorQualification(v.id, state.questions, state.responses);
        return { vendorId: v.id, supplier: v.name, passedAllMandatory: q.passedAllMandatory, weightedScore: q.weightedScore, failedMandatory: q.failedMandatoryQuestions.map((f) => ({ questionId: f.question.id, question: f.question.questionText, reason: f.reason })) };
      });
      return {
        data: { outcomes: rows, mandatoryQuestionIds: state.questions.filter((q) => q.mandatoryCriterion).map((q) => q.id), dataOrigin: 'sample_input: answers supplied with the project, not extracted from vendor documents, not buyer-verified' },
        table: { title: 'Questionnaire outcomes (sample answers)', headers: ['Supplier', 'Mandatory', 'Weighted score', 'Failed questions'], rows: rows.map((r) => [r.supplier, r.passedAllMandatory ? 'pass' : 'FAIL', r.weightedScore, r.failedMandatory.map((f) => f.questionId).join(', ') || '—']) },
      };
    }

    case 'get_extraction_exceptions': {
      const a = z.object({ vendorId: z.string().optional(), status: z.enum(['open', 'resolved', 'all']).optional() }).parse(rawArgs);
      vendorOf(state, a.vendorId);
      const list = state.exceptions.filter((e) => (!a.vendorId || e.vendorId === a.vendorId) && ((a.status ?? 'open') === 'all' || ((a.status ?? 'open') === 'open') === (e.status !== 'Resolved (Buyer Verified)')));
      return {
        data: { count: list.length, exceptions: list.map((e) => ({ id: e.id, supplier: short(state, e.vendorId), itemId: e.itemId, severity: e.severity, type: e.type, title: e.title, description: e.description, status: e.status, recommendedAction: e.recommendedAction })) },
        table: { title: 'Extraction exceptions', headers: ['ID', 'Supplier', 'Item', 'Severity', 'Issue', 'Status'], rows: list.map((e) => [e.id, short(state, e.vendorId), e.itemId, e.severity, e.title, e.status]) },
      };
    }

    case 'evaluate_award_scenario': {
      const a = z.object({
        strategy: z.enum(STRATEGIES), vendorIds: z.array(z.string()).optional(), singleVendorId: z.string().optional(),
        enforceMandatoryQuestions: z.boolean().optional(), includeUnverifiedAssumptions: z.boolean().optional(),
        applyConditionalDiscounts: z.boolean().optional(), maxLeadTimeDays: z.number().positive().optional(),
      }).parse(rawArgs);
      vendorOf(state, a.singleVendorId);
      (a.vendorIds ?? []).forEach((id) => vendorOf(state, id));
      if (a.strategy === 'single_vendor_custom' && !a.singleVendorId) throw new ToolError('singleVendorId is required for single_vendor_custom.');
      const config: ScenarioConfig = {
        id: 'analyst', name: `${a.strategy}${a.singleVendorId ? ` (${short(state, a.singleVendorId)})` : ''}`, strategy: a.strategy,
        singleTargetVendorId: a.singleVendorId, includedVendorIds: a.singleVendorId ? [a.singleVendorId] : a.vendorIds ?? state.vendors.map((v) => v.id),
        enforceMandatoryQualityGate: a.enforceMandatoryQuestions ?? true, includeUnverifiedAssumptions: a.includeUnverifiedAssumptions ?? false,
        usdToInrRate: state.usdToInrRate, applyGlobalFootnoteDiscount: a.applyConditionalDiscounts ?? true,
        standardFreightOverridePct: null, maxLeadTimeDaysFilter: a.maxLeadTimeDays ?? 21,
      };
      const r = evaluateScenario(config, state.lineItems, state.vendors, state.quoteCells, state.questions, state.responses, state.exceptions);
      const baseline = r.totalBaselineCostInr;
      return {
        data: {
          scenario: config.name,
          totalCost: { inr: r2(r.totalProcurementCostInr), display: formatInr(r.totalProcurementCostInr), lakhs: formatLakhs(r.totalProcurementCostInr) },
          baseline: { inr: r2(baseline), display: formatInr(baseline), lakhs: formatLakhs(baseline) },
          savings: { inr: r2(r.totalSavingsInr), display: formatInr(r.totalSavingsInr), lakhs: formatLakhs(r.totalSavingsInr), pct: r.savingsPct },
          awardedLines: r.awardedLineItemsCount, unallocatedLines: r.unallocatedLineItemsCount,
          caveat: r.unallocatedLineItemsCount > 0 ? `${r.unallocatedLineItemsCount} line(s) have no usable price and are costed at baseline in the totals, so savings only reflect the ${r.awardedLineItemsCount} awarded line(s).` : undefined,
          unverifiedAssumptionsIncluded: r.unresolvedExceptionsIncludedCount,
          avgLeadTimeDays: r.avgDeliveryDays, maxLeadTimeDays: r.maxDeliveryDays, qualityStatus: r.qualityComplianceStatus,
          suppliers: r.vendorSummaries.filter((s) => s.itemsAwarded > 0).map((s) => ({ supplier: s.vendorName, itemsAwarded: s.itemsAwarded, spend: formatInr(s.totalSpendInr), sharePct: s.shareOfSpendPct, qualityQualified: s.qualityQualified })),
          lines: r.itemAllocations.map((x) => ({ itemId: x.itemId, supplier: short(state, x.awardedVendorId), unitPriceInr: x.unitPriceInr, lineCostInr: r2(x.totalLineCostInr), reason: x.allocationReason })),
        },
        table: { title: `Allocation: ${config.name}`, headers: ['Supplier', 'Lines', 'Spend', 'Share %'], rows: r.vendorSummaries.filter((s) => s.itemsAwarded > 0).map((s) => [s.vendorName, s.itemsAwarded, formatInr(s.totalSpendInr), s.shareOfSpendPct]) },
      };
    }

    case 'get_cell_evidence': {
      const a = z.object({ itemId: z.string(), vendorId: z.string() }).parse(rawArgs);
      const v = vendorOf(state, a.vendorId)!;
      const c = state.quoteCells.find((x) => x.itemId === a.itemId && x.vendorId === a.vendorId);
      if (!c) throw new ToolError(`No quote cell for ${a.itemId} / ${a.vendorId}.`);
      const eff = getEffectiveCellPriceInr(c, v);
      return {
        data: {
          itemId: c.itemId, supplier: v.name, quoted: c.quoted, status: cellStatus(c, eff.priceInr), trust: c.trust ?? 'none',
          rawPrice: c.rawQuotedPrice, rawCurrency: c.rawCurrency, rawUnit: c.rawUom, unitFactor: c.conversionFactorToStandard,
          discountPct: c.discountAppliedPct, freightPct: c.freightAdjustmentPct, gstInclusivePct: c.gstInclusivePct ?? 0,
          normalisedPriceInr: eff.priceInr, confidencePct: c.confidencePct, unitExplanation: c.unitExplanation, assumptions: c.assumptions ?? [], blockReasons: c.blockReasons ?? [],
          evidence: (c.evidence ?? []).map((e) => ({ document: e.documentName, locator: e.locator, snippet: e.snippet, check: e.check })),
        },
      };
    }

    default:
      throw new ToolError(`Unknown tool "${name}". Available: ${TOOL_DECLARATIONS.map((t) => t.name).join(', ')}.`);
  }
}
