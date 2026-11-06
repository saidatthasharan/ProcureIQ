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
  AnalystMessage,
  ExtractionException,
} from '../types/procurement';

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
    if (!resp) continue;
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

  // If cell is not comparable (blocked by historical ref, unknown unit, or conflicting values) and buyer hasn't verified it
  if (!cell.isComparable && !cell.buyerVerified && !allowUnverified) {
    return {
      priceInr: null,
      isComparable: false,
      hasUnresolvedAssumption: true,
    };
  }

  let baseInr = cell.normalisedUnitPriceInr ?? cell.provisionalUnitPriceInr;
  if (baseInr === null) {
    return { priceInr: null, isComparable: false, hasUnresolvedAssumption: false };
  }

  // Apply dynamic FX override for USD items (Global Corrugators items 001-005)
  if (cell.rawCurrency === 'USD' && cell.rawQuotedPrice !== null) {
    const fxRate = config?.usdToInrRate ?? 83.5;
    const grossInr = cell.rawQuotedPrice * fxRate;
    const applyFootnote = config?.applyGlobalFootnoteDiscount ?? true;
    const discPct = applyFootnote ? cell.discountAppliedPct : 0;
    baseInr = Number((grossInr * (1 - discPct / 100)).toFixed(2));
  } else if (vendor.id === 'V-GLOBAL') {
    const applyFootnote = config?.applyGlobalFootnoteDiscount ?? true;
    if (!applyFootnote && cell.rawQuotedPrice !== null) {
      baseInr = cell.rawQuotedPrice;
    }
  }

  // Apply freight override if configured for Ex-Works vendors
  if (
    config?.standardFreightOverridePct !== undefined &&
    config.standardFreightOverridePct !== null &&
    cell.freightAdjustmentPct > 0 &&
    cell.rawQuotedPrice !== null
  ) {
    if (vendor.id === 'V-PRIMEPACK') {
      baseInr = Number((cell.rawQuotedPrice * (1 + config.standardFreightOverridePct / 100)).toFixed(2));
    } else if (vendor.id === 'V-SOUTHERN') {
      const exGst = cell.rawQuotedPrice / 1.18;
      baseInr = Number((exGst * (1 + config.standardFreightOverridePct / 100)).toFixed(2));
    }
  }

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
    if (v.deliveryLeadTimeDays > config.maxLeadTimeDaysFilter) return false;
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

  // For single_vendor_best_overall, determine which eligible vendor covers all items at lowest total cost
  let bestSingleVendorId = config.singleTargetVendorId || 'V-APEX';
  if (config.strategy === 'single_vendor_best_overall') {
    let minSingleTotal = Infinity;
    for (const v of eligibleVendors) {
      let vTotal = 0;
      let coversAll = true;
      for (const item of lineItems) {
        const cell = quoteCells.find((c) => c.itemId === item.id && c.vendorId === v.id);
        if (!cell) {
          coversAll = false;
          break;
        }
        const eff = getEffectiveCellPriceInr(cell, v, config);
        if (eff.priceInr === null) {
          coversAll = false;
          break;
        }
        vTotal += eff.priceInr * item.quantity;
      }
      if (coversAll && vTotal < minSingleTotal) {
        minSingleTotal = vTotal;
        bestSingleVendorId = v.id;
      }
    }
  }

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
        config.strategy === 'single_vendor_custom'
          ? config.singleTargetVendorId || 'V-APEX'
          : bestSingleVendorId;
      chosen = candidateQuotes.find((c) => c.vendor.id === targetId);
      reason = chosen
        ? `Consolidated Single-Vendor Award (${chosen.vendor.shortName})`
        : `Selected single vendor did not quote or is ineligible for ${item.id}`;
    } else if (config.strategy === 'fastest_delivery_priority') {
      candidateQuotes.sort((a, b) => {
        if (a.vendor.deliveryLeadTimeDays !== b.vendor.deliveryLeadTimeDays) {
          return a.vendor.deliveryLeadTimeDays - b.vendor.deliveryLeadTimeDays;
        }
        return a.priceInr - b.priceInr;
      });
      chosen = candidateQuotes[0];
      if (chosen) {
        reason = `Fastest Lead Time (${chosen.vendor.deliveryLeadTimeDays}d) + Best Rate`;
      }
    } else if (config.strategy === 'dual_vendor_resilient_split') {
      const dualCandidates = candidateQuotes
        .filter((c) => c.vendor.id === 'V-APEX' || c.vendor.id === 'V-GLOBAL')
        .sort((a, b) => a.priceInr - b.priceInr);
      chosen = dualCandidates[0] || candidateQuotes.sort((a, b) => a.priceInr - b.priceInr)[0];
      if (chosen) {
        reason = `Dual-Supplier Resilient Split (Lowest between Tier-1 Full-Scope Vendors)`;
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
        qualityQualified: Boolean(vendorQualifications.get(v.id)),
        unresolvedExceptionsCount: openExcs,
      };
    })
    .filter((s) => s.itemsAwarded > 0 || eligibleVendorIds.has(s.vendorId));

  const awardedVendorLeadTimes = vendorSummaries
    .filter((s) => s.itemsAwarded > 0)
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

// Deterministic Dataset-Driven AI Procurement Analyst Engine
export function generateDeterministicAnalystResponse(
  prompt: string,
  lineItems: LineItem[],
  vendors: Vendor[],
  quoteCells: VendorQuoteCell[],
  questions: QuestionnaireQuestion[],
  responses: VendorQuestionnaireResponse[],
  exceptions: ExtractionException[]
): AnalystMessage {
  const qLower = prompt.toLowerCase();
  const baselineTotal = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.baselineUnitPriceInr,
    0
  );

  const extractedCount = vendors.filter(
    (v) => v.processingStatus === 'extracted_NeedsReview' || v.processingStatus === 'verified'
  ).length;

  // Compute against effective extracted dataset while noting inbox status if unextracted
  const simulatedVendors: Vendor[] = vendors.map((v) => ({
    ...v,
    processingStatus:
      v.processingStatus === 'unextracted' ? 'extracted_NeedsReview' : v.processingStatus,
  }));

  const splitScenario = evaluateScenario(
    {
      id: 'sim-split',
      name: 'Cheapest Quality-Qualified Split',
      strategy: 'cheapest_eligible_split',
      includedVendorIds: vendors.map((v) => v.id),
      enforceMandatoryQualityGate: true,
      includeUnverifiedAssumptions: false,
      usdToInrRate: 83.5,
      applyGlobalFootnoteDiscount: true,
      standardFreightOverridePct: null,
      maxLeadTimeDaysFilter: 21,
    },
    lineItems,
    simulatedVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const apexSingle = evaluateScenario(
    {
      id: 'single-apex',
      name: 'Single Vendor — Apex Packaging',
      strategy: 'single_vendor_custom',
      singleTargetVendorId: 'V-APEX',
      includedVendorIds: ['V-APEX'],
      enforceMandatoryQualityGate: true,
      includeUnverifiedAssumptions: false,
      usdToInrRate: 83.5,
      applyGlobalFootnoteDiscount: true,
      standardFreightOverridePct: null,
      maxLeadTimeDaysFilter: 21,
    },
    lineItems,
    simulatedVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const globalSingle = evaluateScenario(
    {
      id: 'single-global',
      name: 'Single Vendor — Global Corrugators',
      strategy: 'single_vendor_custom',
      singleTargetVendorId: 'V-GLOBAL',
      includedVendorIds: ['V-GLOBAL'],
      enforceMandatoryQualityGate: true,
      includeUnverifiedAssumptions: false,
      usdToInrRate: 83.5,
      applyGlobalFootnoteDiscount: true,
      standardFreightOverridePct: null,
      maxLeadTimeDaysFilter: 21,
    },
    lineItems,
    simulatedVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const southernUnrestrictedSingle = evaluateScenario(
    {
      id: 'single-southern',
      name: 'Single Vendor — Southern Box (Disqualified)',
      strategy: 'single_vendor_custom',
      singleTargetVendorId: 'V-SOUTHERN',
      includedVendorIds: ['V-SOUTHERN'],
      enforceMandatoryQualityGate: false,
      includeUnverifiedAssumptions: true,
      usdToInrRate: 83.5,
      applyGlobalFootnoteDiscount: true,
      standardFreightOverridePct: null,
      maxLeadTimeDaysFilter: 21,
    },
    lineItems,
    simulatedVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  // Check if user asked about a specific Item ID (e.g. PKG-HYD-012, PKG-HYD-007, etc.)
  const matchedItem = lineItems.find(
    (i) =>
      qLower.includes(i.id.toLowerCase()) ||
      qLower.includes(i.code.toLowerCase())
  );
  if (matchedItem) {
    const alloc = splitScenario.itemAllocations.find((a) => a.itemId === matchedItem.id);
    const winningVendor = vendors.find((v) => v.id === alloc?.awardedVendorId);
    const rows = vendors.map((v) => {
      const c = quoteCells.find((cell) => cell.itemId === matchedItem.id && cell.vendorId === v.id);
      const qual = calculateVendorQualification(v.id, questions, responses);
      return [
        v.name,
        v.documentFormat,
        c?.quoted
          ? c.rawQuotedPrice !== null
            ? `${c.rawCurrency === 'USD' ? '$' : '₹'}${c.rawQuotedPrice.toFixed(2)} / ${c.rawUom}`
            : 'Historical Ref (2025)'
          : 'No Quote',
        c?.normalisedUnitPriceInr !== null && c?.normalisedUnitPriceInr !== undefined
          ? `₹${c.normalisedUnitPriceInr.toFixed(2)}`
          : c?.quoted
          ? `Blocked (₹${c.provisionalUnitPriceInr?.toFixed(2)})`
          : '—',
        qual.passedAllMandatory ? `Qualified (${qual.weightedScore}%)` : 'DISQUALIFIED (QA)',
        c?.sourceReference || '—',
      ];
    });

    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer: `${matchedItem.id} (${matchedItem.description}): Lowest eligible normalised bid is ${winningVendor?.shortName || 'Unallocated'} at ₹${alloc?.unitPriceInr?.toFixed(2) || '—'}/${matchedItem.standardUom} (Total Line Cost: ${formatInr(alloc?.totalLineCostInr || 0)} for ${matchedItem.quantity.toLocaleString('en-IN')} ${matchedItem.standardUom}).`,
      narrativeParagraphs: [
        `Technical Specification: ${matchedItem.gsmAndFlute} · ${matchedItem.burstingStrengthCS} · Dimensions: ${matchedItem.dimensionsMm}.`,
        `Baseline Rate: ₹${matchedItem.baselineUnitPriceInr.toFixed(2)}/${matchedItem.standardUom} (${formatInr(matchedItem.quantity * matchedItem.baselineUnitPriceInr)} total). Recommended allocation saves ${formatInr(alloc?.savingsInr || 0)} on this line item.`,
      ],
      tableData: {
        headers: ['Vendor', 'Format', 'Raw Extracted Input', 'Normalised DDP (INR)', 'Quality Gate', 'Source Citation'],
        rows,
      },
      calculationBreakdown: [
        `Quantity: ${matchedItem.quantity.toLocaleString('en-IN')} ${matchedItem.standardUom}`,
        `Baseline Unit Price: ₹${matchedItem.baselineUnitPriceInr.toFixed(2)} -> Baseline Total: ${formatInr(matchedItem.quantity * matchedItem.baselineUnitPriceInr)}`,
        `Lowest Eligible Unit Price: ₹${alloc?.unitPriceInr?.toFixed(2) ?? '—'} (${winningVendor?.shortName}) -> Award Total: ${formatInr(alloc?.totalLineCostInr || 0)}`,
      ],
      dataSources: rows.map((r) => `${r[0]}: ${r[5]}`),
      assumptions: ['All prices normalised to DDP Pashamylaram, Exclusive of 18% GST.'],
      unresolvedRisks: [
        matchedItem.id === 'PKG-HYD-012'
          ? 'PrimePack has conflicting values on PKG-HYD-012 between Page 2 Para 4 (₹74.76 Ex-Works) and Schedule B (₹79.50 Ex-Works).'
          : 'Southern Box Mfg. is excluded from award eligibility due to mandatory QA gate failure.',
      ],
    };
  }

  // QUESTION 1: Which vendor is cheapest for every/each line item?
  if (
    qLower.includes('cheapest') &&
    (qLower.includes('every line item') ||
      qLower.includes('each line item') ||
      (qLower.includes('line item') && !qLower.includes('split')))
  ) {
    const winCounts: Record<string, number> = {};
    splitScenario.itemAllocations.forEach((a) => {
      if (a.awardedVendorId) {
        winCounts[a.awardedVendorId] = (winCounts[a.awardedVendorId] || 0) + 1;
      }
    });

    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer: `Across all ${lineItems.length} line items (enforcing mandatory quality gates), EcoWrap Packaging is cheapest on ${winCounts['V-ECOWRAP'] || 11} items, PrimePack Solutions on ${winCounts['V-PRIMEPACK'] || 14} items, Global Corrugators on ${winCounts['V-GLOBAL'] || 3} items, and Apex Packaging on ${winCounts['V-APEX'] || 2} items.`,
      narrativeParagraphs: [
        'Southern Box Manufacturing quotes lower raw rates on all 30 items, but is excluded from eligible lowest-bidder status due to failing 3 mandatory quality criteria (expired ISO 9001, max 14 kg/cm² bursting strength vs required 18–24 kg/cm², and 2.4% historical defect rate).',
        'Among quality-qualified vendors, EcoWrap leads on Protective Packaging, Corrugated Sheets, and Rolls, PrimePack leads on 3-Ply & mid-sized cartons (even after +3.5% freight), and Global Corrugators + Apex Packaging win heavy 5-ply export & custom cartons.',
      ],
      tableData: {
        headers: [
          'Item ID',
          'Product Description',
          'Qty & UOM',
          'Lowest Eligible Vendor',
          'Normalised Price (INR)',
          'Lowest Raw (Incl. Disqualified)',
        ],
        rows: lineItems.map((item) => {
          const alloc = splitScenario.itemAllocations.find((a) => a.itemId === item.id);
          const winVendor = vendors.find((v) => v.id === alloc?.awardedVendorId);
          const southCell = quoteCells.find(
            (c) => c.itemId === item.id && c.vendorId === 'V-SOUTHERN'
          );
          return [
            item.id,
            item.description,
            `${item.quantity.toLocaleString('en-IN')} ${item.standardUom}`,
            winVendor?.shortName || 'N/A',
            alloc?.unitPriceInr ? `₹${alloc.unitPriceInr.toFixed(2)}` : '-',
            southCell?.normalisedUnitPriceInr
              ? `₹${southCell.normalisedUnitPriceInr.toFixed(2)} (Southern - QA Disq.)`
              : '-',
          ];
        }),
      },
      chartData: {
        type: 'bar',
        title: 'Line Items Won by Quality-Qualified Vendor (All 30 Line Items)',
        xKey: 'vendor',
        yKey: 'itemsWon',
        data: splitScenario.vendorSummaries
          .filter((s) => s.itemsAwarded > 0)
          .map((s) => ({
            vendor: s.vendorName.split(' ')[0],
            itemsWon: s.itemsAwarded,
            spendLakhs: Number((s.totalSpendInr / 100000).toFixed(2)),
          })),
      },
      calculationBreakdown: [
        `Total Baseline Spend (${lineItems.length} items): ${formatInr(baselineTotal)} (${formatLakhs(baselineTotal)})`,
        `Cheapest Quality-Qualified Split Spend: ${formatInr(splitScenario.totalProcurementCostInr)} (${formatLakhs(splitScenario.totalProcurementCostInr)})`,
        `Net Savings vs Baseline: ${formatInr(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%)`,
      ],
      dataSources: [
        'Apex_HydPlant_Quotation_2026_ModifiedCols.xlsx (30/30 items)',
        'GlobalCorrugators_CommercialBid_HYD2026.pdf (30/30 items + Page 3 Footnote *)',
        'PrimePack_Proposal_Narrative_2026.docx (27/30 items, +3.5% freight)',
        'RE_RFQ_Hyderabad_Corrugated_Packaging_2026.eml (22/30 items, 4 blocked)',
      ],
      assumptions: [
        'USD to INR exchange rate fixed at ₹83.50 for Global Corrugators items PKG-HYD-001 to 005.',
        'EcoWrap items with unverified 2025 historical pricing (009, 010, 018) and unknown Pallet Load UOM (019) are excluded until verified.',
      ],
      unresolvedRisks: [
        extractedCount < 5
          ? `${5 - extractedCount} vendor document(s) are still in Pending Extraction state in the Vendor Response Inbox.`
          : 'PrimePack has a conflicting price on PKG-HYD-012 (₹77.38 vs ₹82.28 landed).',
      ],
    };
  }

  // QUESTION 2: What is the total cost if we award everything to one vendor?
  if (qLower.includes('one vendor') || qLower.includes('single')) {
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer: `Only two quality-qualified vendors quoted all 30 line items: Global Corrugators Ltd. (${formatLakhs(globalSingle.totalProcurementCostInr)} net of 4.5% footnote discount) and Apex Packaging Industries (${formatLakhs(apexSingle.totalProcurementCostInr)}).`,
      narrativeParagraphs: [
        `Awarding 100% of the order to Global Corrugators costs ${formatInr(globalSingle.totalProcurementCostInr)} (saving ${globalSingle.savingsPct}% vs the ${formatLakhs(baselineTotal)} baseline), provided the Page-3 4.5% volume rebate is contractually locked.`,
        `Awarding 100% to Apex Packaging costs ${formatInr(apexSingle.totalProcurementCostInr)} (saving ${apexSingle.savingsPct}% vs baseline) with zero currency exposure and a faster 12-day lead time from Medchal.`,
        `PrimePack Solutions (27/30 items quoted) and EcoWrap Packaging (22/30 items quoted) cannot fulfil a 100% single-vendor award due to unquoted items.`,
      ],
      tableData: {
        headers: [
          'Vendor Name',
          'Items Quoted',
          'Quality Status',
          '100% Single-Award Total (INR)',
          'Savings vs Baseline',
          'Full-Scope Eligible?',
        ],
        rows: [
          [
            'Global Corrugators Ltd.',
            '30 / 30',
            'Qualified (94.8/100)',
            formatInr(globalSingle.totalProcurementCostInr),
            `${formatLakhs(globalSingle.totalSavingsInr)} (${globalSingle.savingsPct}%)`,
            'Yes (Cheapest Single Vendor)',
          ],
          [
            'Apex Packaging Industries',
            '30 / 30',
            'Qualified (95.7/100)',
            formatInr(apexSingle.totalProcurementCostInr),
            `${formatLakhs(apexSingle.totalSavingsInr)} (${apexSingle.savingsPct}%)`,
            'Yes (Zero FX Risk, 12d Lead)',
          ],
          [
            'PrimePack Solutions',
            '27 / 30',
            'Qualified (84.1/100)',
            'Incomplete (Missing 3 Items)',
            'N/A for 100% Award',
            'No (Missing Items 027, 028, 030)',
          ],
          [
            'EcoWrap Packaging',
            '22 / 30',
            'Qualified (91.5/100)',
            'Incomplete (Missing 8 Items)',
            'N/A for 100% Award',
            'No (Missing 8 Custom Items)',
          ],
          [
            'Southern Box Manufacturing',
            '30 / 30',
            'DISQUALIFIED (46.2/100)',
            `${formatInr(southernUnrestrictedSingle.totalProcurementCostInr)} (Ineligible)`,
            'Blocked by Mandatory QA Gate',
            'No (Failed ISO & Burst Test)',
          ],
        ],
      },
      chartData: {
        type: 'bar',
        title: 'Total Portfolio Cost Comparison: Single Vendor vs Multi-Vendor Split (₹ Lakhs)',
        xKey: 'scenario',
        yKey: 'costLakhs',
        data: [
          { scenario: '2026 Baseline', costLakhs: Number((baselineTotal / 100000).toFixed(2)) },
          {
            scenario: '100% Apex',
            costLakhs: Number((apexSingle.totalProcurementCostInr / 100000).toFixed(2)),
          },
          {
            scenario: '100% Global (w/ -4.5%)',
            costLakhs: Number((globalSingle.totalProcurementCostInr / 100000).toFixed(2)),
          },
          {
            scenario: 'Multi-Vendor Split',
            costLakhs: Number((splitScenario.totalProcurementCostInr / 100000).toFixed(2)),
          },
        ],
      },
      calculationBreakdown: [
        `Baseline Budget: ${formatInr(baselineTotal)}`,
        `Global Corrugators Gross Bid: ${formatInr(globalSingle.totalProcurementCostInr / 0.955)} -> Less 4.5% Footnote Discount = ${formatInr(globalSingle.totalProcurementCostInr)}`,
        `Apex Packaging Landed Bid (Normalised for CONV-001 & CONV-002): ${formatInr(apexSingle.totalProcurementCostInr)}`,
        `Additional Savings from Multi-Vendor Split vs Cheapest Single Vendor: ${formatInr(globalSingle.totalProcurementCostInr - splitScenario.totalProcurementCostInr)}`,
      ],
      dataSources: [
        'GlobalCorrugators_CommercialBid_HYD2026.pdf (Pages 1–3 + Footnote *)',
        'Apex_HydPlant_Quotation_2026_ModifiedCols.xlsx (Rows 9–38)',
      ],
      assumptions: [
        'Global Corrugators 4.5% footnote discount applies because total award exceeds the ₹25,00,000 threshold.',
      ],
      unresolvedRisks: [
        'Single-sourcing 100% of 30 packaging SKUs creates single-point corrugator downtime risk during monsoon peak months.',
      ],
    };
  }

  // QUESTION 3: What happens if we split the purchase among the cheapest quality-qualified vendors?
  if (qLower.includes('split') && !qLower.includes('recommend')) {
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer: `Splitting the purchase across the 4 quality-qualified vendors reduces total procurement spend to ${formatInr(splitScenario.totalProcurementCostInr)} (${formatLakhs(splitScenario.totalProcurementCostInr)}), saving ${formatInr(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%) against the baseline and saving an extra ${formatLakhs(globalSingle.totalProcurementCostInr - splitScenario.totalProcurementCostInr)} compared to the best single-vendor option.`,
      narrativeParagraphs: [
        `Under the Cheapest Quality-Qualified Split, each of the 30 line items is awarded to the lowest normalised DDP bidder that passed all 4 mandatory quality gates (ISO 9001, >=18 kg/cm² Bursting Lab, <=1% Defect Rate, Statutory Compliance).`,
        `PrimePack Solutions wins middle-tier 3-ply and custom boxes, EcoWrap Packaging wins protective edge protectors, sheets, and rolls, Global Corrugators wins heavy 5-ply export & UN-4G hazardous cartons, and Apex Packaging covers unquoted specialty items.`,
      ],
      tableData: {
        headers: [
          'Qualified Supplier',
          'Line Items Won',
          'Allocated Spend (INR)',
          'Share of Spend',
          'Delivery Lead Time',
          'Open Exceptions',
        ],
        rows: splitScenario.vendorSummaries
          .filter((s) => s.itemsAwarded > 0)
          .map((s) => [
            s.vendorName,
            `${s.itemsAwarded} / ${lineItems.length} SKUs`,
            formatInr(s.totalSpendInr),
            `${s.shareOfSpendPct}%`,
            `${s.avgLeadTimeDays} Days`,
            `${s.unresolvedExceptionsCount} Open`,
          ]),
      },
      chartData: {
        type: 'bar',
        title: 'Spend Allocation in Cheapest Quality-Qualified Split (₹ Lakhs)',
        xKey: 'vendor',
        yKey: 'spendLakhs',
        data: splitScenario.vendorSummaries
          .filter((s) => s.itemsAwarded > 0)
          .map((s) => ({
            vendor: s.vendorName.split(' ')[0],
            spendLakhs: Number((s.totalSpendInr / 100000).toFixed(2)),
          })),
      },
      calculationBreakdown: [
        `2026 Baseline Portfolio Cost: ${formatInr(baselineTotal)}`,
        `Best Single-Vendor Cost (Global Corrugators): ${formatInr(globalSingle.totalProcurementCostInr)}`,
        `Cheapest Quality-Qualified Split Cost: ${formatInr(splitScenario.totalProcurementCostInr)}`,
        `Total Savings vs Baseline: ${formatInr(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%)`,
      ],
      dataSources: [
        '30-Item Normalised DDP Bid Matrix',
        'Scenario Simulator Engine (cheapest_eligible_split)',
      ],
      assumptions: [
        'Unverified EcoWrap items (009, 010, 018, 019) and PrimePack conflict item (012) are held back until buyer-verified.',
      ],
      unresolvedRisks: [
        'Managing 4 active packaging suppliers requires coordinated kanban scheduling at Pashamylaram receiving docks.',
      ],
    };
  }

  // QUESTION 4: Which vendors failed mandatory quality checks?
  if (
    qLower.includes('failed') ||
    qLower.includes('disqualified') ||
    (qLower.includes('quality') &&
      !qLower.includes('delivery') &&
      !qLower.includes('balance'))
  ) {
    const qualRows = vendors.map((v) => {
      const qual = calculateVendorQualification(v.id, questions, responses);
      const r01 = responses.find((r) => r.vendorId === v.id && r.questionId === 'Q-01');
      const r02 = responses.find((r) => r.vendorId === v.id && r.questionId === 'Q-02');
      const r07 = responses.find((r) => r.vendorId === v.id && r.questionId === 'Q-07');
      return [
        v.name,
        `${qual.weightedScore} / 100`,
        r01?.passedMandatoryCheck ? 'PASS (Active ISO)' : 'FAIL (Expired May 2025)',
        r02?.passedMandatoryCheck ? 'PASS (>=18-24 kg/cm² Lab)' : 'FAIL (Max 14 kg/cm² only)',
        r07?.passedMandatoryCheck ? 'PASS (<=0.62% Defect)' : 'FAIL (2.40% Defect Rate)',
        qual.passedAllMandatory ? 'ELIGIBLE' : 'DISQUALIFIED (Hard Gate)',
      ];
    });

    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer:
        'Southern Box Manufacturing (Vendor D) failed 3 of the 4 Mandatory Quality Gates and is hard-disqualified from award eligibility.',
      narrativeParagraphs: [
        'ProcureIQ enforces a strict separation between a low soft questionnaire score and a hard mandatory gate failure. Even though Southern Box Manufacturing quoted the lowest raw price across most items, they failed Q-01 (Expired ISO 9001 certificate), Q-02 (Maximum bursting strength capability of 14 kg/cm² vs mandatory 18–24 kg/cm² for 5-ply master cartons), and Q-07 (2.4% lot rejection rate vs ≤1.0% threshold).',
        'All other four vendors (Apex Packaging, Global Corrugators, PrimePack Solutions, and EcoWrap Packaging) passed 100% of mandatory quality and statutory compliance checks.',
      ],
      tableData: {
        headers: [
          'Vendor',
          'Weighted Score',
          'Q-01: ISO 9001 (Mandatory)',
          'Q-02: 18+ kg/cm² Burst Lab (Mandatory)',
          'Q-07: Defect Rate <=1% (Mandatory)',
          'Eligibility Status',
        ],
        rows: qualRows,
      },
      calculationBreakdown: [
        'Mandatory Criteria Configured: Q-01 (ISO 9001:2015), Q-02 (In-house Bursting/BCT >= 18 kg/cm²), Q-07 (Defect Rate <= 1.0%), Q-09 (Statutory & GST Compliance).',
        'Southern Box failed 3/4 mandatory checks -> Hard Disqualification triggered.',
      ],
      dataSources: [
        'SouthernBox_ISO_Expired2025.jpg',
        'Southern_Lab_Declaration.pdf',
        'Self_Disclosure_Form.pdf (Vendor Questionnaire Submission)',
      ],
      assumptions: [
        'Mandatory quality gates are enforced as non-negotiable blockers unless explicitly overridden in Scenario Simulator.',
      ],
      unresolvedRisks: [
        'Awarding 5-ply export or chemical drum cartons (Items 001–006) to a supplier capped at 14 kg/cm² bursting strength creates severe stack-collapse risk in sea transit.',
      ],
    };
  }

  // QUESTION 5: Which vendors quoted fewer than 30 items?
  if (qLower.includes('fewer than 30') || qLower.includes('missing') || qLower.includes('incomplete') || qLower.includes('27')) {
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer:
        'Two vendors quoted fewer than 30 line items: PrimePack Solutions quoted exactly 27 out of 30 items (3 missing) and EcoWrap Packaging quoted 22 out of 30 items (8 missing, plus 4 items blocked by unresolved exceptions).',
      narrativeParagraphs: [
        'PrimePack Solutions (Vendor C) explicitly declined to quote 3 items in Section 3.4 of their Word proposal: PKG-HYD-027 (2-Ply 900mm Wrapping Roll), PKG-HYD-028 (VCI Corrosion-Inhibitor Roll), and PKG-HYD-030 (24-Cell E-Flute Partition Set).',
        'EcoWrap Packaging (Vendor E) submitted an inline email covering 22 standard corrugated items, omitting 8 heavy/custom die-cut items (PKG-HYD-003, 014, 022, 023, 024, 025, 029, 030). Additionally, 3 of EcoWrap’s quoted items (009, 010, 018) reference 2025 historical rates and 1 item (019) uses an unverified "Pallet Load" unit.',
      ],
      tableData: {
        headers: [
          'Vendor',
          'Document Format',
          'Items Quoted',
          'Comparable Ready Items',
          'Blocked / Exception Items',
          'Unquoted Item IDs',
        ],
        rows: [
          ['Apex Packaging', 'Excel (.xlsx)', '30 / 30', '30', '0 (3 UOM rules verified)', 'None (100% Coverage)'],
          ['Global Corrugators', 'PDF (.pdf)', '30 / 30', '30', '0 (Footnote discount flagged)', 'None (100% Coverage)'],
          [
            'PrimePack Solutions',
            'Word (.docx)',
            '27 / 30',
            '26',
            '1 (Item 012 price conflict)',
            'PKG-HYD-027, PKG-HYD-028, PKG-HYD-030',
          ],
          [
            'Southern Box Mfg.',
            'Image (.jpg)',
            '30 / 30',
            '0 (Quality Disq.)',
            '3 Low-OCR items (004, 015, 023)',
            'None (Disqualified on QA)',
          ],
          [
            'EcoWrap Packaging',
            'Email (.eml)',
            '22 / 30',
            '18',
            '4 (Items 009, 010, 018, 019)',
            '003, 014, 022, 023, 024, 025, 029, 030',
          ],
        ],
      },
      calculationBreakdown: [
        'Total Matrix Cells: 30 items × 5 vendors = 150 quotation slots',
        'Total Quoted Slots: 139 / 150 (92.7% coverage)',
        'Missing Slots: 11 (3 from PrimePack + 8 from EcoWrap)',
      ],
      dataSources: [
        'PrimePack_Proposal_Narrative_2026.docx (Section 3.4, Page 6)',
        'RE_RFQ_Hyderabad_Corrugated_Packaging_2026.eml (Line 31)',
      ],
      assumptions: [
        'Unquoted items cannot be imputed and require split-awarding to full-scope vendors.',
      ],
      unresolvedRisks: [
        'Neither PrimePack (27/30) nor EcoWrap (22/30) can serve as a 100% single-source supplier.',
      ],
    };
  }

  // QUESTION 6: What is the impact of freight charges?
  if (qLower.includes('freight')) {
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer:
        'Freight normalisation adds +3.5% (₹11.21 Lakhs across 27 quoted items) to PrimePack Solutions and +4.0% to Southern Box Manufacturing, ensuring true DDP Pashamylaram parity against Apex, Global, and EcoWrap.',
      narrativeParagraphs: [
        'Apex Packaging, Global Corrugators, and EcoWrap Packaging quoted on a Delivered Duty Paid (DDP TSIIC Pashamylaram Plant) basis with freight included.',
        'PrimePack Solutions quoted Ex-Works Balanagar in their Word proposal, stating in Section 4 Paragraph 3 that dedicated 32-ft container freight to Pashamylaram is charged extra at +3.5%. Without Rule CONV-005 (+3.5% freight normalisation), PrimePack would appear artificially cheaper on 6 line items where Apex or Global is actually lower on a landed basis.',
      ],
      tableData: {
        headers: [
          'Vendor',
          'Quoted Incoterm / Basis',
          'Freight Adder %',
          'Normalisation Formula',
          'Portfolio Freight Impact (INR)',
          'Governance Status',
        ],
        rows: [
          ['Apex Packaging', 'DDP Pashamylaram', '0.0% (Included)', 'Landed = Quoted × 1.00', '₹0 (Included in Base)', 'Buyer Verified'],
          ['Global Corrugators', 'DDP Pashamylaram', '0.0% (Included)', 'Landed = Quoted × 0.955 (-4.5% Disc)', '₹0 (Included in Base)', 'Buyer Verified'],
          ['PrimePack Solutions', 'Ex-Works Balanagar', '+3.5% Extra', 'Landed = Ex-Works × 1.035 (CONV-005)', '+₹11,21,480 (Across 27 Items)', 'Buyer Verified'],
          ['Southern Box Mfg.', 'Ex-Katedan (Tempo)', '+4.0% Extra', 'Landed = (Gross ÷ 1.18) × 1.04 (CONV-006)', '+₹12,74,720 (Disqualified)', 'AI Suggested'],
          ['EcoWrap Packaging', 'DDP Pashamylaram (9 km)', '0.0% (Included)', 'Landed = Quoted × 1.00', '₹0 (Included in Base)', 'Buyer Verified'],
        ],
      },
      calculationBreakdown: [
        'PrimePack Ex-Works Portfolio (27 quoted items): ₹3,20,42,285 -> +3.5% Freight (₹11,21,480) = ₹3,31,63,765 Landed',
        'Southern Box GST-Inclusive Rate Card: Stripped 18% GST (÷1.18) then added +4.0% tempo freight (×1.04).',
      ],
      dataSources: [
        'PrimePack_Proposal_Narrative_2026.docx (Section 4, Paragraph 3 — Rule CONV-005)',
        'IMG_20261104_114822_SignedRateCard.jpg (Rubber Stamp Header — Rule CONV-006)',
      ],
      assumptions: ['All vendor bids are evaluated on a landed DDP TSIIC Pashamylaram plant gate basis.'],
      unresolvedRisks: ['Ensure PrimePack PO explicitly caps freight at 3.5% regardless of diesel fuel surcharge fluctuations.'],
    };
  }

  // QUESTION 7: Which quotations contain unresolved assumptions?
  if (qLower.includes('unresolved') || qLower.includes('assumption') || qLower.includes('exception')) {
    const openExcs = exceptions.filter((e) => e.status !== 'Resolved (Buyer Verified)');
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer: `There are currently ${openExcs.length} unresolved exceptions/assumptions across the 5 vendor quotations (including 3 Critical blockers that prevent direct line-item comparison until buyer-verified).`,
      narrativeParagraphs: [
        '1. EcoWrap Packaging (.eml): Quoted Item 019 as "₹8,500 per Pallet Load" without stating sheets per pallet (CONV-007 / EXC-001), and referenced "Same as Q3 2025 PO rate" on Items 009, 010, and 018 without stating a 2026 price (CONV-008 / EXC-002). Both are blocked from automatic award.',
        '2. PrimePack Solutions (.docx): Lists ₹74.76/Box Ex-Works for Item 012 in Page 2 Paragraph 4, conflicting with ₹79.50/Box in Page 5 Schedule B (EXC-003). Blocked until buyer selects the authoritative rate.',
        '3. Global Corrugators (.pdf) & Southern Box (.jpg): Global’s 4.5% Page-3 footnote discount (EXC-005) and Southern Box’s 61.5% low-OCR handwritten overwrites on Items 004, 015, 023 (EXC-004) are flagged for buyer sign-off.',
      ],
      tableData: {
        headers: ['ID', 'Severity', 'Vendor', 'Affected Items', 'Assumption / Issue', 'Current Status'],
        rows: exceptions.map((e) => {
          const v = vendors.find((vend) => vend.id === e.vendorId);
          return [
            e.id,
            e.severity,
            v?.shortName || e.vendorId,
            e.id === 'EXC-002' ? 'PKG-HYD-009, 010, 018' : e.id === 'EXC-004' ? 'PKG-HYD-004, 015, 023' : e.itemId,
            e.title,
            e.status,
          ];
        }),
      },
      calculationBreakdown: [
        `Total Exceptions Logged: ${exceptions.length}`,
        `Currently Open / Blocked: ${openExcs.length}`,
        `Buyer Verified / Resolved: ${exceptions.length - openExcs.length}`,
      ],
      dataSources: [
        'Document Intelligence Exception Queue (EXC-001 to EXC-008)',
        'Standardisation Engine Rules (CONV-001 to CONV-008)',
      ],
      assumptions: [
        'ProcureIQ governance blocks any ambiguous unit ("Pallet Load") or unconfirmed historical price ("Same as 2025") from winning an award until verified by the buyer.',
      ],
      unresolvedRisks: [
        'Unblocking EcoWrap’s 4 held items after supplier confirmation could unlock an additional ₹1.45 Lakhs in split-award savings.',
      ],
    };
  }

  // QUESTION 8: What is our potential savings against the baseline?
  if (qLower.includes('saving') || qLower.includes('baseline')) {
    const categories = Array.from(new Set(lineItems.map((i) => i.category)));
    const catRows = categories.map((cat) => {
      const catItems = lineItems.filter((i) => i.category === cat);
      const catAllocs = splitScenario.itemAllocations.filter((a) =>
        catItems.some((i) => i.id === a.itemId)
      );
      const base = catAllocs.reduce((s, a) => s + a.baselineLineCostInr, 0);
      const award = catAllocs.reduce((s, a) => s + a.totalLineCostInr, 0);
      const sav = base - award;
      const pct = base > 0 ? ((sav / base) * 100).toFixed(2) : '0.00';
      return [
        cat,
        `${catItems.length} SKUs`,
        formatInr(base),
        formatInr(award),
        formatInr(sav),
        `${pct}%`,
      ];
    });

    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer: `Total verified savings against the 2026 baseline (${formatLakhs(baselineTotal)}) is ${formatInr(splitScenario.totalSavingsInr)} (${formatLakhs(splitScenario.totalSavingsInr)} or ${splitScenario.savingsPct}%) under the optimal quality-qualified multi-vendor split.`,
      narrativeParagraphs: [
        `Compared to a single-vendor award to Apex Packaging (${formatLakhs(apexSingle.totalSavingsInr)} savings / ${apexSingle.savingsPct}%) or Global Corrugators (${formatLakhs(globalSingle.totalSavingsInr)} savings / ${globalSingle.savingsPct}%), category-specialist split awarding captures an additional ${formatLakhs(globalSingle.totalProcurementCostInr - splitScenario.totalProcurementCostInr)} in value.`,
        `The highest percentage reductions are achieved in Protective Packaging (13.3% savings via EcoWrap), Corrugated Sheets (11.8% savings), and 3-Ply Corrugated Boxes (11.2% savings).`,
      ],
      tableData: {
        headers: [
          'Packaging Category',
          'SKUs',
          '2026 Baseline Spend',
          'Optimal Split Spend',
          'Net Savings (INR)',
          'Savings %',
        ],
        rows: catRows,
      },
      chartData: {
        type: 'bar',
        title: 'Net Procurement Savings by Award Strategy (₹ Lakhs)',
        xKey: 'strategy',
        yKey: 'savingsLakhs',
        data: [
          {
            strategy: '100% Apex',
            savingsLakhs: Number((apexSingle.totalSavingsInr / 100000).toFixed(2)),
          },
          {
            strategy: '100% Global',
            savingsLakhs: Number((globalSingle.totalSavingsInr / 100000).toFixed(2)),
          },
          {
            strategy: 'Optimal QA Split',
            savingsLakhs: Number((splitScenario.totalSavingsInr / 100000).toFixed(2)),
          },
        ],
      },
      calculationBreakdown: [
        `2026 Baseline Spend: ${formatInr(baselineTotal)} (${formatLakhs(baselineTotal)})`,
        `Optimal Quality-Qualified Split Spend: ${formatInr(splitScenario.totalProcurementCostInr)} (${formatLakhs(splitScenario.totalProcurementCostInr)})`,
        `Net Verified Savings: ${formatInr(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%)`,
      ],
      dataSources: [
        'Category-Level Savings Realisation Report',
        '30-Item Baseline Budget vs Normalised Bid Matrix',
      ],
      assumptions: ['Savings exclude Southern Box Manufacturing due to mandatory quality gate failure.'],
      unresolvedRisks: ['Resolving PrimePack Item 012 and EcoWrap Items 009, 010, 018, 019 increases total savings to ~10.1%.'],
    };
  }

  // QUESTION 9: Which vendor provides the best delivery commitment / balance of price, quality and delivery?
  if (
    qLower.includes('delivery') ||
    qLower.includes('lead time') ||
    qLower.includes('fastest') ||
    qLower.includes('balance')
  ) {
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      promptText: prompt,
      isDemoSimulation: true,
      headlineAnswer:
        'Among quality-qualified suppliers, Apex Packaging Industries provides the fastest full-scope commitment (12 calendar days + 48-hour VMI buffer at Medchal, 38 km away), while EcoWrap Packaging offers the closest plant proximity (9 km from Pashamylaram in Patancheru IDA, 20-minute transit).',
      narrativeParagraphs: [
        'Although Southern Box Manufacturing quoted a 10-day lead time, they use open-body tarpaulin tempo trucks and are disqualified on mandatory ISO 9001 and bursting strength criteria.',
        'All four qualified suppliers meet the RFQ target delivery SLA of <=15 calendar days: Apex Packaging (12 days), Global Corrugators (14 days via Jeedimetla cross-dock), EcoWrap Packaging (14 days standard / same-day milk run for stock items), and PrimePack Solutions (15 days).',
      ],
      tableData: {
        headers: [
          'Vendor',
          'Committed Lead Time',
          'Distance to Pashamylaram Plant',
          'Logistics & Buffer Capability',
          'SLA Compliance (<=15d)',
          'Quality Status',
        ],
        rows: [
          ['Apex Packaging', '12 Days', '38 km (Medchal Park)', '8 owned 32-ft container trucks + 48-hr VMI buffer', 'PASS (Best Full-Scope)', 'Qualified (95.7%)'],
          ['EcoWrap Packaging', '14 Days (Stock: Same-Day)', '9 km (Patancheru IDA)', '20-min transit milk-run; closest to plant', 'PASS (Closest Proximity)', 'Qualified (91.5%)'],
          ['Global Corrugators', '14 Days', '32 km (Jeedimetla Hub)', 'SEZ manufacturing + Jeedimetla GPS cross-dock', 'PASS', 'Qualified (94.8%)'],
          ['PrimePack Solutions', '15 Days', '28 km (Balanagar Unit)', '3P dedicated container (+3.5% Ex-Works)', 'PASS (At 15d Limit)', 'Qualified (84.1%)'],
          ['Southern Box Mfg.', '10 Days', '44 km (Katedan Estate)', 'Hired open-body tempo trucks with tarpaulin', 'Disqualified on QA', 'DISQUALIFIED (46.2%)'],
        ],
      },
      chartData: {
        type: 'bar',
        title: 'Committed Delivery Lead Time by Supplier (Calendar Days)',
        xKey: 'vendor',
        yKey: 'leadDays',
        data: vendors.map((v) => ({
          vendor: v.shortName,
          leadDays: v.deliveryLeadTimeDays,
        })),
      },
      calculationBreakdown: [
        'RFQ Target Delivery SLA: <= 15 Calendar Days DDP TSIIC Pashamylaram',
        `Optimal Split Average Lead Time: ${splitScenario.avgDeliveryDays} Days (Max: ${splitScenario.maxDeliveryDays} Days)`,
      ],
      dataSources: [
        'Vendor Questionnaire Responses Q-06 (Fleet & Proximity) & Q-11 (Lead Time)',
        'SLA_Commitment_Apex.pdf & Plant_Location_Proof.pdf',
      ],
      assumptions: ['48-hour VMI safety stock at Apex Medchal covers sudden assembly line call-offs.'],
      unresolvedRisks: ['Open-body tempo transport during Hyderabad monsoon months causes moisture delamination; only closed-container vendors are selected.'],
    };
  }

  // QUESTION 10 / DEFAULT: Prepare an award recommendation for the VP.
  return {
    id: `msg-${Date.now()}`,
    role: 'assistant',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    promptText: prompt,
    isDemoSimulation: true,
    headlineAnswer: `Recommended Strategy: Multi-Vendor Best-of-Breed Split across our 4 Quality-Qualified Suppliers (PrimePack Solutions, EcoWrap Packaging, Global Corrugators, and Apex Packaging), achieving a total landed cost of ${formatInr(splitScenario.totalProcurementCostInr)} (${formatLakhs(splitScenario.totalProcurementCostInr)}) and saving ${formatInr(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%) against the 2026 baseline.`,
    narrativeParagraphs: [
      `1. Executive Summary for VP of Procurement: By splitting the 30 line items across our quality-qualified specialists while enforcing mandatory ISO 9001 and >=18 kg/cm² Bursting Strength gates, AERCHAIN reduces annualised Hyderabad packaging spend from ${formatLakhs(baselineTotal)} to ${formatLakhs(splitScenario.totalProcurementCostInr)} — an immediate saving of ${formatLakhs(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%).`,
      `2. Recommended Allocation: Award heavy 5-ply export & UN-4G cartons to Global Corrugators Ltd. (leveraging their 4.5% Page-3 footnote rebate), high-volume 3-ply & domestic shipping cartons to PrimePack Solutions and Apex Packaging Industries (12-day lead time from Medchal), and protective packaging, sheets & rolls to EcoWrap Packaging (located 9 km from Pashamylaram plant).`,
      `3. Governance & Disqualification Note: Southern Box Manufacturing is excluded despite lower nominal rates due to failing 3 mandatory QA criteria (lapsed ISO 9001, insufficient 14 kg/cm² bursting strength, and 2.4% lot defect rate).`,
    ],
    tableData: {
      headers: [
        'Awarded Vendor',
        'Items Awarded',
        'Awarded Spend (INR)',
        'Portfolio Share',
        'Lead Time',
        'Quality Score & Status',
      ],
      rows: splitScenario.vendorSummaries
        .filter((s) => s.itemsAwarded > 0)
        .map((s) => [
          s.vendorName,
          `${s.itemsAwarded} items`,
          formatInr(s.totalSpendInr),
          `${s.shareOfSpendPct}%`,
          `${s.avgLeadTimeDays} Days`,
          s.qualityQualified ? '100% Mandatory Pass' : 'Disqualified',
        ]),
    },
    chartData: {
      type: 'bar',
      title: 'Recommended Split Award Spend by Supplier (₹ Lakhs)',
      xKey: 'vendor',
      yKey: 'spendLakhs',
      data: splitScenario.vendorSummaries
        .filter((s) => s.itemsAwarded > 0)
        .map((s) => ({
          vendor: s.vendorName.split(' ')[0],
          spendLakhs: Number((s.totalSpendInr / 100000).toFixed(2)),
          items: s.itemsAwarded,
        })),
    },
    calculationBreakdown: [
      `2026 Baseline Budget (30 Line Items): ${formatInr(baselineTotal)} (${formatLakhs(baselineTotal)})`,
      `Optimal Quality-Qualified Split Total: ${formatInr(splitScenario.totalProcurementCostInr)} (${formatLakhs(splitScenario.totalProcurementCostInr)})`,
      `Total Verified Savings vs Baseline: ${formatInr(splitScenario.totalSavingsInr)} (${splitScenario.savingsPct}%)`,
      `Savings vs Cheapest Single-Vendor (Global Corrugators): ${formatInr(globalSingle.totalProcurementCostInr - splitScenario.totalProcurementCostInr)} additional savings`,
    ],
    dataSources: [
      '30-Item Normalised Bid Matrix (DDP Pashamylaram, Excl. 18% GST)',
      '12-Point Vendor Qualification Matrix (QA Lab & ISO Verification)',
      'Standardisation Engine Rules CONV-001 to CONV-008',
    ],
    assumptions: [
      'Global Corrugators 4.5% footnote rebate confirmed applicable to split award > ₹25 Lakhs.',
      'EcoWrap historical reference items (009, 010, 018) and unverified Pallet Load item (019) are held back from EcoWrap until written clarification is logged.',
    ],
    unresolvedRisks: [
      'Obtain written addendum from Global Corrugators confirming the Page-3 4.5% footnote discount applies to a partial split award.',
      'Resolve PrimePack’s Schedule B vs Paragraph 4 discrepancy on Item PKG-HYD-012 prior to PO release.',
    ],
  };
}
