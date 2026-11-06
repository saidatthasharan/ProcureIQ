import React, { useState } from 'react';
import {
  Award,
  CheckCircle2,
  Edit3,
  FileSearch,
  Download,
  ShieldAlert,
  Sparkles,
  Check,
  X,
  FileText,
  Truck,
  ShieldCheck,
} from 'lucide-react';
import {
  LineItem,
  Vendor,
  VendorQuoteCell,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  ExtractionException,
  ScenarioConfig,
} from '../types/procurement';
import {
  evaluateScenario,
  formatInr,
  formatLakhs,
} from '../services/procurementEngine';
import { TrustBadge } from './GovernanceUI';

interface AwardRecommendationViewProps {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  exceptions: ExtractionException[];
  scenarioConfig: ScenarioConfig;
  awardApprovedByBuyer: boolean;
  onApproveAwardByBuyer: () => void;
  onOpenCellEvidence: (itemId: string, vendorId: string) => void;
  onExportRecommendationCsv: () => void;
  onNotify: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export const AwardRecommendationView: React.FC<AwardRecommendationViewProps> = ({
  lineItems,
  vendors,
  quoteCells,
  questions,
  responses,
  exceptions,
  scenarioConfig,
  awardApprovedByBuyer,
  onApproveAwardByBuyer,
  onOpenCellEvidence,
  onExportRecommendationCsv,
  onNotify,
}) => {
  const [isEditingMemo, setIsEditingMemo] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [executiveRationale, setExecutiveRationale] = useState(
    'Recommend a multi-vendor best-of-breed split award across our 4 quality-qualified suppliers (EcoWrap Packaging, PrimePack Solutions, Global Corrugators Ltd., and Apex Packaging Industries) while enforcing hard disqualification on Southern Box Manufacturing due to lapsed ISO 9001 certification and insufficient 14 kg/cm² bursting strength capability. This allocation locks in 9.7% savings against the 2026 baseline while eliminating single-plant corrugator downtime risk.'
  );

  const effectiveVendors: Vendor[] = vendors.map((v) => ({
    ...v,
    processingStatus:
      v.processingStatus === 'unextracted' ? 'extracted_NeedsReview' : v.processingStatus,
  }));

  const scenarioResult = evaluateScenario(
    scenarioConfig,
    lineItems,
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const awardedSuppliers = scenarioResult.vendorSummaries.filter((s) => s.itemsAwarded > 0);
  const openExceptions = exceptions.filter((e) => e.status !== 'Resolved (Buyer Verified)');

  const strategyTitle =
    scenarioConfig.strategy === 'cheapest_eligible_split'
      ? 'Best-of-Breed Multi-Vendor Split'
      : scenarioConfig.strategy === 'dual_vendor_resilient_split'
      ? 'Dual-Supplier Resilient Split (70/30)'
      : 'Consolidated Single-Vendor Award';

  return (
    <div className="space-y-5">
      {/* Executive Page Header & 5 Governance Actions */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-4 border-b border-slate-200/90">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-lg font-semibold tracking-tight text-[#18181B]">
              Award Recommendation Memo
            </h1>
            {awardApprovedByBuyer ? (
              <TrustBadge
                type="buyer_verified"
                labelOverride="Executive Award Approved (Ready for ERP PO Release)"
              />
            ) : (
              <TrustBadge
                type="ai_generated"
                labelOverride="Draft Decision Package — Requires Human Approval"
              />
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Governance Policy: ProcureIQ never autonomously approves awards or releases Purchase Orders. Final sign-off requires human verification.
          </p>
        </div>

        {/* 5 Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() =>
              onNotify(
                'Synchronised Award Recommendation memo with active Scenario Simulator configuration.',
                'info'
              )
            }
            className="px-3 py-1.5 text-xs font-medium text-[#6161F5] bg-[#6161F5]/[0.08] hover:bg-[#6161F5]/[0.14] border border-[#6161F5]/20 rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate Recommendation</span>
          </button>

          <button
            onClick={() => setShowEvidenceModal(true)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <FileSearch className="w-3.5 h-3.5 text-slate-500" />
            <span>Review Evidence</span>
          </button>

          <button
            onClick={() => setIsEditingMemo(!isEditingMemo)}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Edit3 className="w-3.5 h-3.5 text-slate-500" />
            <span>{isEditingMemo ? 'Lock Memo' : 'Edit Recommendation'}</span>
          </button>

          <button
            onClick={onExportRecommendationCsv}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Report</span>
          </button>

          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={awardApprovedByBuyer}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60 whitespace-nowrap"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{awardApprovedByBuyer ? 'Award Approved' : 'Approve Award'}</span>
          </button>
        </div>
      </div>

      {/* Executive Summary Report Block (5 Core Executive Pillars from Section 11) */}
      <div className="bg-white rounded-lg border border-slate-200/90 overflow-hidden">
        <div className="px-5 py-3 bg-[#18181B] text-white flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#6161F5]" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Executive Sourcing Committee Memorandum — PRJ-HYD-2026-004
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-300">
            Active Scenario: {scenarioConfig.name}
          </span>
        </div>

        {/* 5-Pillar Executive Summary Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 border-b border-slate-200/80">
          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500">
              1. Recommended Award Strategy
            </div>
            <div className="text-xs font-semibold text-[#18181B] mt-1">
              {strategyTitle}
            </div>
            <div className="text-[11px] text-[#6161F5] font-medium mt-1">
              {scenarioResult.awardedLineItemsCount} / 30 Line Items Allocated
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500">
              2. Total Award Value
            </div>
            <div className="text-lg font-semibold font-mono tabular-nums text-[#18181B] mt-0.5">
              {formatLakhs(scenarioResult.totalProcurementCostInr)}
            </div>
            <div className="text-[11px] font-mono text-slate-500 mt-0.5">
              {formatInr(scenarioResult.totalProcurementCostInr)} DDP Net
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500">
              3. Savings Opportunity
            </div>
            <div className="text-lg font-semibold font-mono tabular-nums text-emerald-700 mt-0.5">
              {formatLakhs(scenarioResult.totalSavingsInr)} ({scenarioResult.savingsPct}%)
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              vs {formatLakhs(scenarioResult.totalBaselineCostInr)} Baseline
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500">
              4. Selected Vendors ({awardedSuppliers.length})
            </div>
            <div className="text-xs font-semibold text-[#18181B] mt-1">
              {awardedSuppliers.map((s) => s.vendorName.split(' ')[0]).join(', ')}
            </div>
            <div className="text-[11px] text-emerald-700 mt-1">
              100% Mandatory QA Gate Compliant
            </div>
          </div>

          <div className="p-4">
            <div className="text-[11px] font-medium text-slate-500">
              5. Outstanding Risks
            </div>
            <div className="text-xs font-semibold text-amber-800 mt-1">
              {openExceptions.length} Commercial Clarifications
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Southern Box Mfg. Excluded (QA Fail)
            </div>
          </div>
        </div>

        {/* Executive Decision Memo Narrative & Selected Suppliers Table */}
        <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-[#18181B] uppercase tracking-wider">
                Executive Decision Rationale & Supplier Allocation
              </div>
              {!isEditingMemo && (
                <button
                  onClick={() => setIsEditingMemo(true)}
                  className="text-[11px] font-medium text-[#6161F5] hover:underline cursor-pointer"
                >
                  Edit Memo Narrative
                </button>
              )}
            </div>

            {isEditingMemo ? (
              <div className="space-y-2">
                <textarea
                  rows={4}
                  value={executiveRationale}
                  onChange={(e) => setExecutiveRationale(e.target.value)}
                  className="w-full p-3 text-xs border border-[#6161F5] rounded-md focus:outline-none"
                />
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setIsEditingMemo(false)}
                    className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingMemo(false);
                      onNotify('Executive rationale updated by buyer.', 'success');
                    }}
                    className="px-3 py-1 text-xs font-medium text-white bg-[#6161F5] rounded-md cursor-pointer"
                  >
                    Save Rationale
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-700 leading-relaxed bg-[#FAFAFC] p-4 rounded-md border border-slate-200/90">
                {executiveRationale}
              </p>
            )}

            {/* Selected Vendors Table */}
            <div className="overflow-x-auto border border-slate-200/90 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FAFAFC] border-b border-slate-200/90 text-[11px] font-medium text-slate-500">
                    <th className="py-2 px-3">Selected Supplier</th>
                    <th className="py-2 px-3 text-right">SKUs Awarded</th>
                    <th className="py-2 px-3 text-right">Award Value (INR)</th>
                    <th className="py-2 px-3 text-right">Share</th>
                    <th className="py-2 px-3">Lead Time & Terms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {awardedSuppliers.map((s) => {
                    const v = vendors.find((vend) => vend.id === s.vendorId);
                    return (
                      <tr key={s.vendorId} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-[#18181B]">{s.vendorName}</div>
                          <div className="text-[10px] font-mono text-slate-400">
                            {v?.documentFormat} · Conf: {v?.extractionConfidencePct}%
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          {s.itemsAwarded} SKUs
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-[#18181B]">
                          {formatInr(s.totalSpendInr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[#6161F5] font-medium">
                          {s.shareOfSpendPct}%
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {s.avgLeadTimeDays}d · {v?.paymentTermsQuoted}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Supporting Commercial, Quality, and Delivery Evidence */}
          <div className="lg:col-span-5 space-y-3 text-xs">
            <div className="text-xs font-semibold text-[#18181B] uppercase tracking-wider">
              Supporting Commercial, Quality & Delivery Evidence
            </div>

            <div className="p-3.5 bg-white border border-slate-200/90 rounded-md space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-900">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Quality & Technical Gate Evidence</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                All selected suppliers hold active ISO 9001:2015 certification, in-house bursting/BCT test labs (&ge;18–24 kg/cm²), and historical lot defect rates &le;0.62%. Southern Box Mfg. (46.2/100) is excluded due to mandatory QA failure.
              </p>
            </div>

            <div className="p-3.5 bg-white border border-slate-200/90 rounded-md space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-[#18181B]">
                <Truck className="w-3.5 h-3.5 text-[#6161F5]" />
                <span>Delivery & Supply Chain Resilience Evidence</span>
              </div>
              <p className="text-slate-600 text-[11px] leading-relaxed">
                100% of awarded line items meet the &le;15-day Pashamylaram delivery SLA (avg {scenarioResult.avgDeliveryDays} days; EcoWrap located 9 km from plant; Apex 38 km from Medchal with 48-hr VMI buffer).
              </p>
            </div>

            <div className="p-3.5 bg-amber-50/60 border border-amber-200/90 rounded-md space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-amber-950">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                <span>
                  Commercial Risks & Pre-PO Conditions ({openExceptions.length} Open)
                </span>
              </div>
              <ul className="space-y-1 text-[11px] text-amber-900 leading-relaxed">
                <li>
                  • <strong>Global Corrugators Footnote *:</strong> Confirm in PO addendum that the 4.5% volume rebate applies to the split-award value.
                </li>
                <li>
                  • <strong>PrimePack Item 012 Conflict:</strong> Lock Ex-Works rate at ₹74.76/Box (Page 2 Para 4) rather than Schedule B (₹79.50).
                </li>
                <li>
                  • <strong>EcoWrap Historical & Pallet Refs:</strong> Items 009, 010, 018, 019 withheld from EcoWrap unless written 2026 confirmation is logged.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Line-Item Award Allocation & Evidence Schedule (All 30 Items) */}
      <div className="bg-white rounded-lg border border-slate-200/90 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200/80 bg-[#FAFAFC] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold text-[#18181B] uppercase tracking-wider">
              Line-by-Line Award Schedule & Supporting Source Evidence (30 Line Items)
            </h2>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Click any row to inspect the original vendor document snippet and normalisation math
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            Total DDP Net: {formatInr(scenarioResult.totalProcurementCostInr)}
          </span>
        </div>

        <div className="overflow-x-auto max-h-[480px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#FAFAFC] border-b border-slate-200 text-[11px] font-medium text-slate-500">
              <tr>
                <th className="py-2.5 px-3">Item ID</th>
                <th className="py-2.5 px-3">Product Description</th>
                <th className="py-2.5 px-3 text-right">Qty & UOM</th>
                <th className="py-2.5 px-3">Awarded Supplier</th>
                <th className="py-2.5 px-3 text-right">Awarded Rate</th>
                <th className="py-2.5 px-3 text-right">Extended Award Total</th>
                <th className="py-2.5 px-3 text-right">Line Savings</th>
                <th className="py-2.5 px-3">Supporting Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {scenarioResult.itemAllocations.map((alloc) => {
                const item = lineItems.find((i) => i.id === alloc.itemId)!;
                const v = vendors.find((vend) => vend.id === alloc.awardedVendorId);
                const cell = quoteCells.find(
                  (c) => c.itemId === alloc.itemId && c.vendorId === alloc.awardedVendorId
                );

                return (
                  <tr
                    key={alloc.itemId}
                    onClick={() => {
                      if (alloc.awardedVendorId) {
                        onOpenCellEvidence(alloc.itemId, alloc.awardedVendorId);
                      }
                    }}
                    className="hover:bg-[#6161F5]/[0.04] cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3 font-mono font-medium text-[#18181B]">
                      {alloc.itemId}
                    </td>
                    <td className="py-2 px-3 font-medium text-[#18181B]">
                      {item.description}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600">
                      {item.quantity.toLocaleString('en-IN')} {item.standardUom}
                    </td>
                    <td className="py-2 px-3 font-medium text-[#6161F5]">
                      {v ? v.shortName : 'Unallocated'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold text-[#18181B]">
                      {alloc.unitPriceInr !== null ? `₹${alloc.unitPriceInr.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums font-medium text-[#18181B]">
                      {formatInr(alloc.totalLineCostInr)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-700">
                      +{formatInr(alloc.savingsInr)}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-500 truncate max-w-[200px]">
                      {cell?.sourceReference || 'Click to inspect'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Human Governance Confirmation Modal for Approving Award */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-[#18181B]">
                Confirm Executive Award Sign-Off
              </h3>
              <button
                onClick={() => setShowConfirmModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-600 leading-relaxed">
              <p>
                You are approving the <strong>{scenarioConfig.name}</strong> award recommendation totaling{' '}
                <strong className="font-mono text-[#18181B]">
                  {formatInr(scenarioResult.totalProcurementCostInr)}
                </strong>{' '}
                across <strong>{awardedSuppliers.length} suppliers</strong>.
              </p>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-900">
                <strong>Governance Safeguard:</strong> Approving this recommendation locks the award package for ERP Purchase Order preparation. It does not autonomously transmit external POs without ERP release.
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onApproveAwardByBuyer();
                  setShowConfirmModal(false);
                }}
                className="px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Confirm Buyer Approval</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Evidence Audit Summary Modal */}
      {showEvidenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-2xl w-full p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-[#18181B]">
                Supporting Documentary Evidence Dossier
              </h3>
              <button
                onClick={() => setShowEvidenceModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs max-h-[60vh] overflow-y-auto">
              {vendors.map((v) => (
                <div
                  key={v.id}
                  className="p-3 bg-[#FAFAFC] border border-slate-200/90 rounded-md flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-[#18181B]">
                      {v.code}: {v.name} ({v.documentFileName})
                    </div>
                    <div className="text-slate-500 text-[11px] mt-0.5">
                      {v.documentScenarioSummary}
                    </div>
                  </div>
                  <span className="font-mono text-[#6161F5] font-medium shrink-0 ml-3">
                    Conf: {v.extractionConfidencePct}%
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                onClick={() => setShowEvidenceModal(false)}
                className="px-4 py-1.5 text-xs font-medium bg-[#18181B] text-white rounded-md cursor-pointer"
              >
                Close Dossier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
