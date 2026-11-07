import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  ArrowRight,
  RotateCcw,
  Play,
} from 'lucide-react';
import {
  LineItem,
  Vendor,
  VendorQuoteCell,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  ExtractionException,
  ScenarioConfig,
  AwardAllocationStrategy,
} from '../types/procurement';
import {
  evaluateScenario,
  formatInr,
  formatLakhs,
  calculateVendorQualification,
} from '../services/procurementEngine';
import { TrustBadge } from './GovernanceUI';

interface ScenarioSimulatorViewProps {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  exceptions: ExtractionException[];
  scenarioConfig: ScenarioConfig;
  onChangeScenarioConfig: (updated: ScenarioConfig) => void;
  onPromoteToAward: () => void;
  onExtractAllVendors: () => void;
}

export const ScenarioSimulatorView: React.FC<ScenarioSimulatorViewProps> = ({
  lineItems,
  vendors,
  quoteCells,
  questions,
  responses,
  exceptions,
  scenarioConfig,
  onChangeScenarioConfig,
  onPromoteToAward,
  onExtractAllVendors,
}) => {
  const extractedCount = vendors.filter(
    (v) => v.processingStatus === 'extracted_NeedsReview' || v.processingStatus === 'verified'
  ).length;

  const effectiveVendors: Vendor[] = vendors;

  const currentResult = evaluateScenario(
    scenarioConfig,
    lineItems,
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  // Baseline & Standard Benchmarks for Before-and-After comparison
  const benchmarkSplit = evaluateScenario(
    {
      id: 'bench-split',
      name: 'Standard Optimal QA Split',
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
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const benchmarkSingleGlobal = evaluateScenario(
    {
      ...scenarioConfig,
      name: '100% Global Corrugators',
      strategy: 'single_vendor_custom',
      singleTargetVendorId: 'V-GLOBAL',
      includedVendorIds: ['V-GLOBAL'],
      enforceMandatoryQualityGate: true,
    },
    lineItems,
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const benchmarkSingleApex = evaluateScenario(
    {
      ...scenarioConfig,
      name: '100% Apex Packaging',
      strategy: 'single_vendor_custom',
      singleTargetVendorId: 'V-APEX',
      includedVendorIds: ['V-APEX'],
      enforceMandatoryQualityGate: true,
    },
    lineItems,
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const [compareTargetKey, setCompareTargetKey] = React.useState<
    'optimal_split' | 'single_global' | 'single_apex' | 'dual_resilient' | 'unrestricted_low'
  >('single_global');

  const benchmarkDualResilient = evaluateScenario(
    {
      ...scenarioConfig,
      name: 'Dual-Vendor Resilient Split (Apex + Global)',
      strategy: 'dual_vendor_resilient_split',
      includedVendorIds: ['V-APEX', 'V-GLOBAL'],
      enforceMandatoryQualityGate: true,
    },
    lineItems,
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const benchmarkUnrestrictedLow = evaluateScenario(
    {
      ...scenarioConfig,
      name: 'Unrestricted Lowest Price (QA Gate Off)',
      strategy: 'cheapest_eligible_split',
      includedVendorIds: vendors.map((v) => v.id),
      enforceMandatoryQualityGate: false,
    },
    lineItems,
    effectiveVendors,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const compareTargetMap = {
    optimal_split: {
      label: 'Standard Optimal QA Split (4 Vendors)',
      result: benchmarkSplit,
    },
    single_global: {
      label: '100% Global Corrugators Single-Award',
      result: benchmarkSingleGlobal,
    },
    single_apex: {
      label: '100% Apex Packaging Single-Award',
      result: benchmarkSingleApex,
    },
    dual_resilient: {
      label: 'Dual-Vendor Resilient Split (Apex + Global)',
      result: benchmarkDualResilient,
    },
    unrestricted_low: {
      label: 'Unrestricted Lowest Price (QA Disqualified Included)',
      result: benchmarkUnrestrictedLow,
    },
  };

  const selectedComparisonStrategy = compareTargetMap[compareTargetKey];

  const toggleVendorInclusion = (vendorId: string) => {
    const exists = scenarioConfig.includedVendorIds.includes(vendorId);
    const next = exists
      ? scenarioConfig.includedVendorIds.filter((id) => id !== vendorId)
      : [...scenarioConfig.includedVendorIds, vendorId];
    onChangeScenarioConfig({
      ...scenarioConfig,
      includedVendorIds: next,
    });
  };

  const resetDefaults = () => {
    onChangeScenarioConfig({
      id: 'default-split',
      name: 'Cheapest Quality-Qualified Split',
      strategy: 'cheapest_eligible_split',
      singleTargetVendorId: 'V-GLOBAL',
      includedVendorIds: vendors.map((v) => v.id),
      enforceMandatoryQualityGate: true,
      includeUnverifiedAssumptions: false,
      usdToInrRate: 83.5,
      applyGlobalFootnoteDiscount: true,
      standardFreightOverridePct: null,
      maxLeadTimeDaysFilter: 21,
    });
  };

  const deltaVsStandardSplit =
    currentResult.totalProcurementCostInr - benchmarkSplit.totalProcurementCostInr;

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Scenario Simulator
            </h1>
            <span className="text-xs font-mono text-slate-400">
              Interactive Award Modelling & Sensitivity Analysis
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Simulate supplier splits, quality gate overrides, freight assumptions, and currency exchange rates
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {extractedCount < vendors.length && (
            <button
              onClick={onExtractAllVendors}
              className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 border border-amber-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-amber-700" />
              <span>Mark All 5 Extracted</span>
            </button>
          )}
          <button
            onClick={resetDefaults}
            className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Baseline Split</span>
          </button>
          <button
            onClick={onPromoteToAward}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <span>Apply to Award Recommendation</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Simulator Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Control Column */}
        <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-lg p-5 space-y-5 text-xs">
          {/* Award Strategy Selector */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-900">
              Award Allocation Strategy
            </label>
            <select
              value={scenarioConfig.strategy}
              onChange={(e) =>
                onChangeScenarioConfig({
                  ...scenarioConfig,
                  strategy: e.target.value as AwardAllocationStrategy,
                })
              }
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-md font-medium text-slate-900 focus:outline-none focus:border-[#6161F5]"
            >
              <option value="cheapest_eligible_split">
                Split Order: Cheapest Eligible per Line Item
              </option>
              <option value="dual_vendor_resilient_split">
                Dual-Vendor Resilient Split (Apex + Global)
              </option>
              <option value="single_vendor_best_overall">
                Single Vendor: Best Overall Full-Scope
              </option>
              <option value="single_vendor_custom">
                Single Vendor: Specific Target Supplier
              </option>
              <option value="fastest_delivery_priority">
                Fastest Delivery Lead-Time Priority
              </option>
            </select>

            {scenarioConfig.strategy === 'single_vendor_custom' && (
              <div className="pt-2">
                <label className="block text-[11px] text-slate-500 mb-1">
                  Target Single Supplier
                </label>
                <select
                  value={scenarioConfig.singleTargetVendorId || 'V-APEX'}
                  onChange={(e) =>
                    onChangeScenarioConfig({
                      ...scenarioConfig,
                      singleTargetVendorId: e.target.value,
                      includedVendorIds: Array.from(
                        new Set([...scenarioConfig.includedVendorIds, e.target.value])
                      ),
                    })
                  }
                  className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-md"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.shortName} ({v.itemsQuotedCount}/30 items)
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Vendor Selection Controls */}
          <div className="space-y-2 pt-3 border-t border-slate-200/80">
            <label className="block font-semibold text-slate-900">
              Vendor Selection Pool
            </label>
            <div className="space-y-1.5">
              {vendors.map((v) => {
                const qual = calculateVendorQualification(v.id, questions, responses);
                const included = scenarioConfig.includedVendorIds.includes(v.id);
                const blockedByQa =
                  scenarioConfig.enforceMandatoryQualityGate && !qual.passedAllMandatory;

                return (
                  <label
                    key={v.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-md border cursor-pointer transition-colors ${
                      included && !blockedByQa
                        ? 'bg-white border-slate-300 text-slate-900'
                        : 'bg-slate-50 border-slate-200/70 text-slate-400'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleVendorInclusion(v.id)}
                        className="rounded border-slate-300 text-[#6161F5]"
                      />
                      <span className="font-medium">{v.shortName}</span>
                    </div>
                    <span className="font-mono text-[10px]">
                      {!qual.passedAllMandatory
                        ? 'QA Disqualified'
                        : `${v.itemsQuotedCount}/30 · ${v.deliveryLeadTimeDays}d`}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Eligibility Toggles */}
          <div className="space-y-2.5 pt-3 border-t border-slate-200/80">
            <label className="block font-semibold text-slate-900">
              Eligibility & Commercial Toggles
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={scenarioConfig.enforceMandatoryQualityGate}
                onChange={(e) =>
                  onChangeScenarioConfig({
                    ...scenarioConfig,
                    enforceMandatoryQualityGate: e.target.checked,
                  })
                }
                className="mt-0.5 rounded border-slate-300 text-[#6161F5]"
              />
              <div>
                <div className="font-medium text-slate-800">
                  Enforce Mandatory Quality Gate
                </div>
                <div className="text-[11px] text-slate-500">
                  Excludes any supplier that fails a mandatory question.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={scenarioConfig.applyGlobalFootnoteDiscount}
                onChange={(e) =>
                  onChangeScenarioConfig({
                    ...scenarioConfig,
                    applyGlobalFootnoteDiscount: e.target.checked,
                  })
                }
                className="mt-0.5 rounded border-slate-300 text-[#6161F5]"
              />
              <div>
                <div className="font-medium text-slate-800">
                  Apply Global Corrugators 4.5% Footnote Rebate
                </div>
                <div className="text-[11px] text-slate-500">
                  Page-3 volume discount when total award &gt; ₹25L.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={scenarioConfig.includeUnverifiedAssumptions}
                onChange={(e) =>
                  onChangeScenarioConfig({
                    ...scenarioConfig,
                    includeUnverifiedAssumptions: e.target.checked,
                  })
                }
                className="mt-0.5 rounded border-slate-300 text-[#6161F5]"
              />
              <div>
                <div className="font-medium text-slate-800">
                  Include Unverified Historical / Unit Assumptions
                </div>
                <div className="text-[11px] text-slate-500">
                  Lets assumption-based prices (e.g. unstated tax or freight) count before a buyer confirms them. Past-price references and unknown units never get a price.
                </div>
              </div>
            </label>
          </div>

          {/* Currency & Freight Assumptions */}
          <div className="space-y-3 pt-3 border-t border-slate-200/80">
            <label className="block font-semibold text-slate-900">
              Currency, Freight & Delivery Assumptions
            </label>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">USD / INR Exchange Rate</span>
                <span className="font-mono font-semibold text-slate-900">
                  ₹{scenarioConfig.usdToInrRate.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={78}
                max={90}
                step={0.25}
                value={scenarioConfig.usdToInrRate}
                onChange={(e) =>
                  onChangeScenarioConfig({
                    ...scenarioConfig,
                    usdToInrRate: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-[#6161F5]"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">Ex-Works Freight Adder</span>
                <span className="font-mono font-semibold text-slate-900">
                  {scenarioConfig.standardFreightOverridePct === null
                    ? 'Default (3.5% / 4.0%)'
                    : `${scenarioConfig.standardFreightOverridePct.toFixed(1)}%`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={8}
                step={0.5}
                value={scenarioConfig.standardFreightOverridePct ?? 3.5}
                onChange={(e) =>
                  onChangeScenarioConfig({
                    ...scenarioConfig,
                    standardFreightOverridePct: parseFloat(e.target.value),
                  })
                }
                className="w-full accent-[#6161F5]"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-slate-600">Max Delivery Lead Time</span>
                <span className="font-mono font-semibold text-slate-900">
                  &le; {scenarioConfig.maxLeadTimeDaysFilter} Days
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={21}
                step={1}
                value={scenarioConfig.maxLeadTimeDaysFilter}
                onChange={(e) =>
                  onChangeScenarioConfig({
                    ...scenarioConfig,
                    maxLeadTimeDaysFilter: parseInt(e.target.value, 10),
                  })
                }
                className="w-full accent-[#6161F5]"
              />
            </div>
          </div>
        </div>

        {/* Right Output Column: Before-and-After Impact & Allocation */}
        <div className="lg:col-span-8 space-y-5">
          {/* Compact 6-Metric Impact Summary Strip */}
          <div className="bg-white border border-slate-200/90 rounded-lg grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 text-xs">
            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">Simulated Total</div>
              <div className="text-base font-semibold font-mono text-slate-900 mt-1">
                {formatLakhs(currentResult.totalProcurementCostInr)}
              </div>
              <div className="text-[10px] font-mono text-slate-400">
                {formatInr(currentResult.totalProcurementCostInr)}
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">Savings vs Baseline</div>
              <div className="text-base font-semibold font-mono text-emerald-700 mt-1">
                {formatLakhs(currentResult.totalSavingsInr)}
              </div>
              <div className="text-[10px] font-mono text-emerald-600">
                {currentResult.savingsPct}% reduction
              </div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">vs Standard Split</div>
              <div
                className={`text-base font-semibold font-mono mt-1 ${
                  deltaVsStandardSplit <= 0 ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {deltaVsStandardSplit === 0
                  ? 'Baseline Split'
                  : `${deltaVsStandardSplit > 0 ? '+' : ''}${formatLakhs(deltaVsStandardSplit)}`}
              </div>
              <div className="text-[10px] text-slate-400">Before/After Delta</div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">Vendors Selected</div>
              <div className="text-base font-semibold font-mono text-slate-900 mt-1">
                {currentResult.vendorSummaries.filter((s) => s.itemsAwarded > 0).length} /{' '}
                {currentResult.eligibleVendorsCount}
              </div>
              <div className="text-[10px] text-slate-400">Awarded / Eligible</div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">Items Awarded</div>
              <div className="text-base font-semibold font-mono text-slate-900 mt-1">
                {currentResult.awardedLineItemsCount} / {lineItems.length}
              </div>
              <div className="text-[10px] text-slate-400">SKUs Allocated</div>
            </div>

            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">Quality & Lead Time</div>
              <div
                className={`text-xs font-semibold mt-1 ${
                  currentResult.qualityComplianceStatus === '100% Compliant'
                    ? 'text-emerald-700'
                    : 'text-rose-700'
                }`}
              >
                {currentResult.qualityComplianceStatus === '100% Compliant'
                  ? '100% QA Pass'
                  : 'QA Overridden'}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Max {currentResult.maxDeliveryDays}d Lead
              </div>
            </div>
          </div>

          {/* Supplier Split Breakdown & Chart */}
          <div className="bg-white border border-slate-200/90 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-slate-900">
                  Simulated Supplier Allocation Breakdown
                </h2>
                <p className="text-[11px] text-slate-500">
                  Awarded spend, line item count, delivery lead times, and quality qualification status
                </p>
              </div>
              <TrustBadge
                type={
                  currentResult.qualityComplianceStatus === '100% Compliant'
                    ? 'buyer_verified'
                    : 'quality_disqualified'
                }
                labelOverride={currentResult.qualityComplianceStatus}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
              <div className="md:col-span-5 h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={currentResult.vendorSummaries.map((s) => ({
                      name: s.vendorName.split(' ')[0],
                      lakhs: Number((s.totalSpendInr / 100000).toFixed(2)),
                      qualified: s.qualityQualified,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}L`} />
                    <Tooltip
                      formatter={(val) => [
                        `₹${Number(val ?? 0).toFixed(2)} Lakhs`,
                        'Awarded Spend',
                      ]}
                      contentStyle={{ fontSize: '11px', borderRadius: '6px' }}
                    />
                    <Bar dataKey="lakhs" radius={[4, 4, 0, 0]} barSize={28}>
                      {currentResult.vendorSummaries.map((s, idx) => (
                        <Cell
                          key={idx}
                          fill={s.qualityQualified ? '#6161F5' : '#DC2626'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="md:col-span-7 overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                      <th className="py-2 px-3">Supplier</th>
                      <th className="py-2 px-3 text-right">SKUs</th>
                      <th className="py-2 px-3 text-right">Awarded Cost</th>
                      <th className="py-2 px-3 text-right">Share</th>
                      <th className="py-2 px-3 text-right">Lead Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70">
                    {currentResult.vendorSummaries.map((s) => (
                      <tr key={s.vendorId}>
                        <td className="py-2.5 px-3 font-medium text-slate-900">
                          {s.vendorName}
                          {!s.qualityQualified && (
                            <span className="ml-1.5 text-[10px] text-rose-600 font-semibold">
                              (QA Disq.)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">{s.itemsAwarded}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900">
                          {formatInr(s.totalSpendInr)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-[#6161F5]">
                          {s.shareOfSpendPct}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                          {s.avgLeadTimeDays}d
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Before-and-After Scenario Comparison Matrix */}
          <div className="bg-white border border-slate-200/90 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200/80 bg-slate-50/50">
              <h3 className="text-xs font-semibold text-slate-900">
                Before-and-After Scenario Summary Comparison
              </h3>
              <p className="text-[11px] text-slate-500">
                Compare your active simulation against standard procurement baselines
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4">Scenario</th>
                    <th className="py-2.5 px-4 text-right">Total Spend (INR)</th>
                    <th className="py-2.5 px-4 text-right">Savings vs Baseline</th>
                    <th className="py-2.5 px-4 text-right">Awarded SKUs</th>
                    <th className="py-2.5 px-4 text-right">Max Delivery</th>
                    <th className="py-2.5 px-4">Quality Compliance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {[
                    {
                      label: 'Active Simulation (Strategy A)',
                      res: currentResult,
                      highlight: true,
                    },
                    {
                      label: 'Benchmark: Standard Optimal QA Split (4 Vendors)',
                      res: benchmarkSplit,
                      highlight: false,
                    },
                    {
                      label: 'Benchmark: Dual-Vendor Resilient Split (Apex + Global)',
                      res: benchmarkDualResilient,
                      highlight: false,
                    },
                    {
                      label: 'Benchmark: 100% Global Corrugators Single-Award',
                      res: benchmarkSingleGlobal,
                      highlight: false,
                    },
                    {
                      label: 'Benchmark: 100% Apex Packaging Single-Award',
                      res: benchmarkSingleApex,
                      highlight: false,
                    },
                  ].map((row, idx) => (
                    <tr
                      key={idx}
                      className={
                        row.highlight
                          ? 'bg-[#6161F5]/[0.05] font-semibold'
                          : 'hover:bg-slate-50/80'
                      }
                    >
                      <td className="py-3 px-4 text-slate-900">{row.label}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-900">
                        {formatInr(row.res.totalProcurementCostInr)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-emerald-700">
                        {formatLakhs(row.res.totalSavingsInr)} ({row.res.savingsPct}%)
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {row.res.awardedLineItemsCount} / 30
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {row.res.maxDeliveryDays}d
                      </td>
                      <td className="py-3 px-4">
                        <TrustBadge
                          type={
                            row.res.qualityComplianceStatus === '100% Compliant'
                              ? 'buyer_verified'
                              : 'quality_disqualified'
                          }
                          labelOverride={row.res.qualityComplianceStatus}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Line-by-Line Strategy A vs Strategy B Comparison Table */}
          <div className="bg-white border border-slate-200/90 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200/80 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Side-by-Side Strategy Comparison (All 30 Line Items)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Compare line-item supplier assignment and landed unit cost between Strategy A (Active) and Strategy B
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">Compare Strategy A vs:</span>
                <select
                  value={compareTargetKey}
                  onChange={(e) =>
                    setCompareTargetKey(
                      e.target.value as
                        | 'optimal_split'
                        | 'single_global'
                        | 'single_apex'
                        | 'dual_resilient'
                        | 'unrestricted_low'
                    )
                  }
                  className="px-2.5 py-1 bg-white border border-slate-300 rounded-md font-medium text-slate-800"
                >
                  <option value="single_global">Strategy B: 100% Global Corrugators</option>
                  <option value="single_apex">Strategy B: 100% Apex Packaging</option>
                  <option value="optimal_split">Strategy B: Standard Optimal QA Split</option>
                  <option value="dual_resilient">Strategy B: Dual-Vendor Resilient Split</option>
                  <option value="unrestricted_low">Strategy B: Unrestricted Lowest Price (QA Off)</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto max-h-72">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                  <tr>
                    <th className="py-2 px-3">Item ID</th>
                    <th className="py-2 px-3">Description</th>
                    <th className="py-2 px-3 text-right">Qty</th>
                    <th className="py-2 px-3">Strategy A (Active)</th>
                    <th className="py-2 px-3 text-right">Strategy A Rate</th>
                    <th className="py-2 px-3">Strategy B ({selectedComparisonStrategy.label.split(' ')[0]})</th>
                    <th className="py-2 px-3 text-right">Strategy B Rate</th>
                    <th className="py-2 px-3 text-right">Line Variance (A - B)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60">
                  {lineItems.map((item) => {
                    const allocA = currentResult.itemAllocations.find(
                      (a) => a.itemId === item.id
                    );
                    const allocB = selectedComparisonStrategy.result.itemAllocations.find(
                      (a) => a.itemId === item.id
                    );
                    const vendorA = vendors.find((v) => v.id === allocA?.awardedVendorId);
                    const vendorB = vendors.find((v) => v.id === allocB?.awardedVendorId);
                    const varianceInr =
                      (allocA?.totalLineCostInr ?? 0) - (allocB?.totalLineCostInr ?? 0);

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/80">
                        <td className="py-2 px-3 font-mono font-medium text-slate-900">
                          {item.id}
                        </td>
                        <td className="py-2 px-3 text-slate-700 truncate max-w-[180px]">
                          {item.description}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {item.quantity.toLocaleString('en-IN')}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900">
                          {vendorA?.shortName || 'Unallocated'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-900">
                          {allocA?.unitPriceInr
                            ? `₹${allocA.unitPriceInr.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="py-2 px-3 text-slate-600">
                          {vendorB?.shortName || 'Unallocated'}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-slate-600">
                          {allocB?.unitPriceInr
                            ? `₹${allocB.unitPriceInr.toFixed(2)}`
                            : '—'}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-medium ${
                            varianceInr < 0
                              ? 'text-emerald-700'
                              : varianceInr > 0
                              ? 'text-amber-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {varianceInr === 0
                            ? '₹0'
                            : `${varianceInr > 0 ? '+' : ''}${formatInr(varianceInr)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
