import {
  LineItem,
  Vendor,
  VendorQuoteCell,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  ScenarioConfig,
  ScenarioResult,
  ScenarioItemAllocation,
  ScenarioVendorSummary,
  ExtractionException,
} from '../types/procurement';
import { applyFormula } from '../extraction/normalise';

export function formatInr(amount: number, decimals = 0): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatLakhs(amountInr: number): string {
  const lakhs = amountInr / 100000;
  return `₹${lakhs.toFixed(2)} L`;
}

export function calculateVendorQualification(
  vendorId: string,
  questions: QuestionnaireQuestion[],
  responses: VendorQuestionnaireResponse[]
): {
  weightedScore: number;
  passedAllMandatory: boolean;
  failedMandatoryQuestions: { question: QuestionnaireQuestion; reason: string }[];
} {
  const vendorResponses = responses.filter((r) => r.vendorId === vendorId);
  let weightedScore = 0;
  let passedAllMandatory = true;
  const failedMandatoryQuestions: { question: QuestionnaireQuestion; reason: string }[] = [];

  for (const q of questions) {
    const resp = vendorResponses.find((r) => r.questionId === q.id);
    if (!resp) {
      // No answer to a mandatory question is a FAIL, never a silent pass.
      if (q.mandatoryCriterion) {
        passedAllMandatory = false;
        failedMandatoryQuestions.push({ question: q, reason: 'No response received for this mandatory question.' });
      }
      continue;
    }
    weightedScore += (resp.scoreOutOf100 * q.weightPct) / 100;
    if (q.mandatoryCriterion && !resp.passedMandatoryCheck) {
      passedAllMandatory = false;
      failedMandatoryQuestions.push({
        question: q,
        reason: resp.failureReason || 'Failed mandatory quality threshold.',
      });
    }
  }

  return {
    weightedScore: Number(weightedScore.toFixed(1)),
    passedAllMandatory,
    failedMandatoryQuestions,
  };
}

export function getEffectiveCellPriceInr(
  cell: VendorQuoteCell,
  vendor: Vendor,
  config?: Partial<ScenarioConfig>
): {
  priceInr: number | null;
  isComparable: boolean;
  hasUnresolvedAssumption: boolean;
} {
  // If vendor document has not been extracted yet, price is not available
  if (vendor.processingStatus === 'unextracted' || vendor.processingStatus === 'rejected') {
    return { priceInr: null, isComparable: false, hasUnresolvedAssumption: false };
  }

  if (!cell.quoted) {
    return { priceInr: null, isComparable: false, hasUnresolvedAssumption: false };
  }

  const allowUnverified = config?.includeUnverifiedAssumptions ?? false;

  // Blocked (historical reference, unknown unit, conflict, low confidence...) and not yet verified by a buyer.
  if (!cell.isComparable && !cell.buyerVerified && !allowUnverified) {
    return { priceInr: null, isComparable: false, hasUnresolvedAssumption: true };
  }

  // A price a buyer confirmed always wins over anything extracted.
  if (cell.buyerVerified && cell.buyerConfirmedPriceInr != null) {
    return { priceInr: Number(cell.buyerConfirmedPriceInr.toFixed(2)), isComparable: true, hasUnresolvedAssumption: false };
  }

  let baseInr = cell.normalisedUnitPriceInr ?? cell.provisionalUnitPriceInr;
  if (baseInr === null) {
    return { priceInr: null, isComparable: false, hasUnresolvedAssumption: false };
  }

  // Recompute from the cell's own components so Settings / scenario controls apply to ANY vendor
  // (FX rate, whether conditional discounts are applied, freight override). No vendor-specific rules.
  if (cell.rawQuotedPrice !== null && cell.origin === 'gemini_extraction') {
    const fx = cell.rawCurrency === 'USD' ? config?.usdToInrRate ?? 83.5 : 1;
    const discount = (config?.applyGlobalFootnoteDiscount ?? true) ? cell.discountAppliedPct : 0;
    let freight = cell.freightAdjustmentPct;
    if (config?.standardFreightOverridePct != null && freight > 0) freight = config.standardFreightOverridePct;
    baseInr = applyFormula({
      rawPrice: cell.rawQuotedPrice,
      currency: cell.rawCurrency,
      uomFactor: cell.conversionFactorToStandard,
      fxRate: fx,
      gstInclusivePct: cell.gstInclusivePct ?? 0,
      discountPct: discount,
      freightPct: freight,
    });
  }

  // Anything not yet confirmed by a buyer, or not cleanly system-validated, is an open assumption.
  const hasAssumption =
    !cell.buyerVerified &&
    (cell.validationStatus !== 'verified' || !cell.isComparable);

  return {
    priceInr: Number(baseInr.toFixed(2)),
    isComparable: true,
    hasUnresolvedAssumption: hasAssumption,
  };
}

export function evaluateScenario(
  config: ScenarioConfig,
  lineItems: LineItem[],
  vendors: Vendor[],
  quoteCells: VendorQuoteCell[],
  questions: QuestionnaireQuestion[],
  responses: VendorQuestionnaireResponse[],
  exceptions: ExtractionException[]
): ScenarioResult {
  const vendorQualifications = new Map<string, boolean>();
  vendors.forEach((v) => {
    const qual = calculateVendorQualification(v.id, questions, responses);
    vendorQualifications.set(v.id, qual.passedAllMandatory);
  });

  const eligibleVendors = vendors.filter((v) => {
    if (!config.includedVendorIds.includes(v.id)) return false;
    if (v.processingStatus === 'unextracted' || v.processingStatus === 'rejected') return false;
    if (v.leadTimeStated !== false && v.deliveryLeadTimeDays > config.maxLeadTimeDaysFilter) return false;
    if (config.enforceMandatoryQualityGate && !vendorQualifications.get(v.id)) return false;
    return true;
  });

  const eligibleVendorIds = new Set(eligibleVendors.map((v) => v.id));

  const itemAllocations: ScenarioItemAllocation[] = [];
  let totalProcurementCostInr = 0;
  let totalBaselineCostInr = 0;
  let awardedLineItemsCount = 0;
  let unallocatedLineItemsCount = 0;
  let unresolvedExceptionsIncludedCount = 0;

  // Vendor selection for the single-vendor and dual-vendor strategies. Generic: no vendor is special.
  const coverageOf = (v: Vendor) => {
    let covered = 0;
    let total = 0;
    for (const item of lineItems) {
      const cell = quoteCells.find((c) => c.itemId === item.id && c.vendorId === v.id);
      const eff = cell ? getEffectiveCellPriceInr(cell, v, config) : null;
      if (eff && eff.priceInr !== null) {
        covered++;
        total += eff.priceInr * item.quantity;
      } else {
        total += item.quantity * item.baselineUnitPriceInr; // uncovered lines fall back to the baseline reserve
      }
    }
    return { covered, total };
  };
  const ranked = eligibleVendors
    .map((v) => ({ v, ...coverageOf(v) }))
    .sort((a, b) => (b.covered !== a.covered ? b.covered - a.covered : a.total - b.total));

  let bestSingleVendorId: string | null = ranked[0]?.v.id ?? null;
  const dualIds: string[] =
    config.dualVendorIds && config.dualVendorIds.length >= 2
      ? config.dualVendorIds.filter((id) => eligibleVendorIds.has(id))
      : ranked.slice(0, 2).map((r) => r.v.id);

  for (const item of lineItems) {
    const baselineLineCost = item.quantity * item.baselineUnitPriceInr;
    totalBaselineCostInr += baselineLineCost;

    const candidateQuotes: {
      vendor: Vendor;
      cell: VendorQuoteCell;
      priceInr: number;
      hasAssumption: boolean;
    }[] = [];

    for (const v of eligibleVendors) {
      const cell = quoteCells.find((c) => c.itemId === item.id && c.vendorId === v.id);
      if (!cell) continue;
      const eff = getEffectiveCellPriceInr(cell, v, config);
      if (eff.priceInr !== null) {
        candidateQuotes.push({
          vendor: v,
          cell,
          priceInr: eff.priceInr,
          hasAssumption: eff.hasUnresolvedAssumption,
        });
      }
    }

    let chosen: (typeof candidateQuotes)[0] | undefined;
    let reason = '';

    if (config.strategy === 'single_vendor_best_overall' || config.strategy === 'single_vendor_custom') {
      const targetId =
        config.strategy === 'single_vendor_custom' ? config.singleTargetVendorId ?? null : bestSingleVendorId;
      chosen = targetId ? candidateQuotes.find((c) => c.vendor.id === targetId) : undefined;
      reason = chosen
        ? `Consolidated Single-Vendor Award (${chosen.vendor.shortName})`
        : `Selected single vendor did not quote or is ineligible for ${item.id}`;
    } else if (config.strategy === 'fastest_delivery_priority') {
      const lead = (v: Vendor) => (v.leadTimeStated === false ? Number.POSITIVE_INFINITY : v.deliveryLeadTimeDays);
      candidateQuotes.sort((a, b) => {
        if (lead(a.vendor) !== lead(b.vendor)) return lead(a.vendor) - lead(b.vendor);
        return a.priceInr - b.priceInr;
      });
      chosen = candidateQuotes[0];
      if (chosen) {
        reason =
          chosen.vendor.leadTimeStated === false
            ? 'Lead time not stated by any candidate; lowest price used'
            : `Fastest Lead Time (${chosen.vendor.deliveryLeadTimeDays}d) + Best Rate`;
      }
    } else if (config.strategy === 'dual_vendor_resilient_split') {
      const dualCandidates = candidateQuotes.filter((c) => dualIds.includes(c.vendor.id)).sort((a, b) => a.priceInr - b.priceInr);
      if (dualCandidates[0]) {
        chosen = dualCandidates[0];
        reason = `Dual-Supplier Split (lower of ${dualIds.length} selected vendors)`;
      } else {
        chosen = candidateQuotes.sort((a, b) => a.priceInr - b.priceInr)[0];
        if (chosen) reason = 'Neither selected vendor quoted this line; lowest other eligible quote used';
      }
    } else {
      // cheapest_eligible_split
      candidateQuotes.sort((a, b) => a.priceInr - b.priceInr);
      chosen = candidateQuotes[0];
      if (chosen) {
        reason = `Lowest Eligible Normalised Bid (${chosen.vendor.shortName})`;
      }
    }

    if (chosen) {
      const lineCost = chosen.priceInr * item.quantity;
      totalProcurementCostInr += lineCost;
      awardedLineItemsCount++;
      if (chosen.hasAssumption) {
        unresolvedExceptionsIncludedCount++;
      }
      itemAllocations.push({
        itemId: item.id,
        awardedVendorId: chosen.vendor.id,
        unitPriceInr: chosen.priceInr,
        totalLineCostInr: lineCost,
        baselineLineCostInr: baselineLineCost,
        savingsInr: baselineLineCost - lineCost,
        isFallbackOrUnallocated: false,
        allocationReason: reason,
      });
    } else {
      unallocatedLineItemsCount++;
      totalProcurementCostInr += baselineLineCost;
      itemAllocations.push({
        itemId: item.id,
        awardedVendorId: null,
        unitPriceInr: null,
        totalLineCostInr: baselineLineCost,
        baselineLineCostInr: baselineLineCost,
        savingsInr: 0,
        isFallbackOrUnallocated: true,
        allocationReason: 'Unallocated (No eligible extracted vendor quote available — using baseline reserve)',
      });
    }
  }

  const vendorSummaries: ScenarioVendorSummary[] = vendors
    .map((v) => {
      const awarded = itemAllocations.filter((a) => a.awardedVendorId === v.id);
      const spend = awarded.reduce((acc, a) => acc + a.totalLineCostInr, 0);
      const openExcs = exceptions.filter(
        (e) => e.vendorId === v.id && e.status !== 'Resolved (Buyer Verified)'
      ).length;
      return {
        vendorId: v.id,
        vendorName: v.name,
        itemsAwarded: awarded.length,
        totalSpendInr: spend,
        shareOfSpendPct:
          totalProcurementCostInr > 0
            ? Number(((spend / totalProcurementCostInr) * 100).toFixed(1))
            : 0,
        avgLeadTimeDays: v.deliveryLeadTimeDays,
        leadTimeStated: v.leadTimeStated !== false,
        qualityQualified: Boolean(vendorQualifications.get(v.id)),
        unresolvedExceptionsCount: openExcs,
      };
    })
    .filter((s) => s.itemsAwarded > 0 || eligibleVendorIds.has(s.vendorId));

  const awardedVendorLeadTimes = vendorSummaries
    .filter((s) => s.itemsAwarded > 0 && s.leadTimeStated !== false)
    .map((s) => s.avgLeadTimeDays);

  const maxDeliveryDays =
    awardedVendorLeadTimes.length > 0 ? Math.max(...awardedVendorLeadTimes) : 0;
  const avgDeliveryDays =
    awardedVendorLeadTimes.length > 0
      ? Number(
          (
            awardedVendorLeadTimes.reduce((a, b) => a + b, 0) /
            awardedVendorLeadTimes.length
          ).toFixed(1)
        )
      : 0;

  const totalSavingsInr = totalBaselineCostInr - totalProcurementCostInr;
  const savingsPct =
    totalBaselineCostInr > 0
      ? Number(((totalSavingsInr / totalBaselineCostInr) * 100).toFixed(2))
      : 0;

  const anyDisqualifiedAwarded = vendorSummaries.some(
    (s) => s.itemsAwarded > 0 && !s.qualityQualified
  );

  return {
    config,
    totalProcurementCostInr,
    totalBaselineCostInr,
    totalSavingsInr,
    savingsPct,
    awardedLineItemsCount,
    unallocatedLineItemsCount,
    eligibleVendorsCount: eligibleVendors.length,
    maxDeliveryDays,
    avgDeliveryDays,
    qualityComplianceStatus: anyDisqualifiedAwarded
      ? 'Non-Compliant Override Active'
      : '100% Compliant',
    unresolvedExceptionsIncludedCount,
    vendorSummaries,
    itemAllocations,
  };
}
