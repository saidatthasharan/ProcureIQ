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
  ArrowUpRight,
  Play,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Table2,
  Bot,
  ChevronRight,
  Wallet,
  Users,
  Inbox,
  Layers,
  AlertCircle,
  TrendingDown,
} from 'lucide-react';
import {
  LineItem,
  Vendor,
  VendorQuoteCell,
  ExtractionException,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  WorkspaceId,
} from '../types/procurement';
import {
  formatInr,
  formatLakhs,
  calculateVendorQualification,
  evaluateScenario,
} from '../services/procurementEngine';
import { TrustBadge, DocumentFormatIcon } from './GovernanceUI';

interface OverviewViewProps {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  exceptions: ExtractionException[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  onNavigate: (workspace: WorkspaceId, filterHint?: string) => void;
  onExtractAllVendors: () => void;
  isExtractingAll: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  lineItems,
  vendors,
  quoteCells,
  exceptions,
  questions,
  responses,
  onNavigate,
  onExtractAllVendors,
  isExtractingAll,
}) => {
  const totalBaselineValue = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.baselineUnitPriceInr,
    0
  );

  const processedVendors = vendors.filter(
    (v) => v.processingStatus === 'extracted_NeedsReview' || v.processingStatus === 'verified'
  );
  const allExtracted = processedVendors.length === vendors.length;

  const openExceptions = exceptions.filter(
    (e) => e.status !== 'Resolved (Buyer Verified)'
  );

  const effectiveVendorsForCalc: Vendor[] = vendors.map((v) => ({
    ...v,
    processingStatus:
      v.processingStatus === 'unextracted' ? 'extracted_NeedsReview' : v.processingStatus,
  }));

  const optimalSplit = evaluateScenario(
    {
      id: 'overview-split',
      name: 'Optimal Quality-Qualified Split',
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
    effectiveVendorsForCalc,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const cycleProgressPct = Math.min(
    95,
    Math.round(
      45 +
        (processedVendors.length / vendors.length) * 30 +
        ((exceptions.length - openExceptions.length) / Math.max(1, exceptions.length)) * 20
    )
  );

  const workflowStages = [
    { label: 'RFQ Created', detail: '30 SKUs · Oct 28', state: 'completed' },
    { label: 'Vendors Invited', detail: '5 Suppliers', state: 'completed' },
    { label: 'Responses Received', detail: '5 Formats Logged', state: 'completed' },
    {
      label: 'Evaluation',
      detail: allExtracted
        ? `${openExceptions.length} Exceptions in Review`
        : `${processedVendors.length}/5 Extracted`,
      state: 'current',
    },
    { label: 'Award', detail: 'Pending VP Sign-off', state: 'upcoming' },
  ];

  const compactKpis = [
    {
      label: 'RFQ Estimated Value',
      value: formatLakhs(totalBaselineValue),
      sub: `${formatInr(totalBaselineValue)} baseline`,
      icon: Wallet,
      target: 'rfx-workspace' as WorkspaceId,
      hint: 'all',
    },
    {
      label: 'Vendors Invited',
      value: `${vendors.length}`,
      sub: '4 Qualified · 1 QA Disqualified',
      icon: Users,
      target: 'bid-comparison' as WorkspaceId,
      hint: 'questionnaire',
    },
    {
      label: 'Responses Received',
      value: `${vendors.length} / ${vendors.length}`,
      sub: allExtracted
        ? 'All 5 documents extracted'
        : `${processedVendors.length}/5 extracted`,
      icon: Inbox,
      target: 'vendor-responses' as WorkspaceId,
      hint: 'all',
    },
    {
      label: 'Line Items Evaluated',
      value: `${lineItems.length}`,
      sub: '8 Corrugated Categories',
      icon: Layers,
      target: 'bid-comparison' as WorkspaceId,
      hint: 'all',
    },
    {
      label: 'Pending Exceptions',
      value: `${openExceptions.length}`,
      sub: 'OCR, UOM & Historical Refs',
      icon: AlertCircle,
      target: 'document-intelligence' as WorkspaceId,
      hint: 'exceptions',
    },
    {
      label: 'Potential Savings',
      value: `${formatLakhs(optimalSplit.totalSavingsInr)}`,
      sub: `${optimalSplit.savingsPct}% below baseline`,
      icon: TrendingDown,
      target: 'scenario-simulator' as WorkspaceId,
      hint: 'split',
    },
  ];

  const singleApexScenario = evaluateScenario(
    {
      id: 'overview-apex',
      name: '100% Apex Packaging',
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
    effectiveVendorsForCalc,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const singleGlobalScenario = evaluateScenario(
    {
      id: 'overview-global',
      name: '100% Global Corrugators',
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
    effectiveVendorsForCalc,
    quoteCells,
    questions,
    responses,
    exceptions
  );

  const spendBenchmarkData = [
    { name: 'Baseline', lakhs: Number((totalBaselineValue / 100000).toFixed(2)), fill: '#A1A1AA' },
    {
      name: '100% Apex',
      lakhs: Number((singleApexScenario.totalProcurementCostInr / 100000).toFixed(2)),
      fill: '#52525B',
    },
    {
      name: '100% Global',
      lakhs: Number((singleGlobalScenario.totalProcurementCostInr / 100000).toFixed(2)),
      fill: '#32323A',
    },
    {
      name: 'Optimal Split',
      lakhs: Number((optimalSplit.totalProcurementCostInr / 100000).toFixed(2)),
      fill: '#6161F5',
    },
  ];

  return (
    <div className="space-y-6">
      {/* A. PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Procurement Overview
            </h1>
            <span className="text-xs font-mono text-slate-400">RFQ-AER-HYD-2026-089</span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Hyderabad Packaging Procurement — 2026 · TSIIC Pashamylaram Manufacturing Plant
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!allExtracted && (
            <button
              onClick={onExtractAllVendors}
              disabled={isExtractingAll}
              className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Play className="w-3 h-3 fill-amber-700 text-amber-700" />
              <span>{isExtractingAll ? 'Extracting...' : `Extract Bids (${5 - processedVendors.length})`}</span>
            </button>
          )}
          <button
            onClick={() => onNavigate('rfx-workspace')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
            <span>Create RFQ</span>
          </button>
          <button
            onClick={() => onNavigate('bid-comparison')}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Table2 className="w-3.5 h-3.5 text-slate-500" />
            <span>View Comparison</span>
          </button>
          <button
            onClick={() => onNavigate('ai-analyst')}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Ask AI Analyst</span>
          </button>
        </div>
      </div>

      {/* B. KPI SUMMARY — 6 Compact Metrics in a Unified Architectural Strip */}
      <div className="bg-white border border-slate-200/90 rounded-lg grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-slate-200/80">
        {compactKpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <button
              key={idx}
              onClick={() => onNavigate(kpi.target, kpi.hint)}
              className="p-4 text-left hover:bg-slate-50/80 transition-colors group flex flex-col justify-between cursor-pointer"
            >
              <div className="flex items-center justify-between text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#6161F5] transition-colors" />
                  <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-800 transition-colors">
                    {kpi.label}
                  </span>
                </div>
                <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 text-[#6161F5] transition-opacity" />
              </div>
              <div className="mt-2.5">
                <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 tracking-tight">
                  {kpi.value}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 truncate">{kpi.sub}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* C. PROCUREMENT PROGRESS — Horizontal Workflow Bar */}
      <div className="bg-white border border-slate-200/90 rounded-lg px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-800">
              Procurement Lifecycle Progress
            </span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500">
              Current Stage: <strong className="text-slate-800 font-medium">Commercial & Technical Evaluation</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold text-[#6161F5]">
              {cycleProgressPct}% Complete
            </span>
            <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#6161F5] rounded-full transition-all"
                style={{ width: `${cycleProgressPct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {workflowStages.map((stage, i) => (
            <div
              key={stage.label}
              className={`px-3 py-2 rounded-md border flex items-center justify-between ${
                stage.state === 'completed'
                  ? 'bg-slate-50/70 border-slate-200/80 text-slate-700'
                  : stage.state === 'current'
                  ? 'bg-[#6161F5]/[0.05] border-[#6161F5]/40 text-slate-900'
                  : 'bg-white border-slate-200/50 text-slate-400'
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-slate-400">0{i + 1}</span>
                  <span className="text-xs font-medium truncate">{stage.label}</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  {stage.detail}
                </div>
              </div>
              {stage.state === 'completed' && (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              )}
              {stage.state === 'current' && (
                <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-[#6161F5] text-white rounded">
                  Active
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* MAIN TWO-COLUMN WORKSPACE: D. Vendor Response Overview (Left) + E. Pending Actions (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* D. VENDOR RESPONSE OVERVIEW TABLE */}
        <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-lg overflow-hidden flex flex-col justify-between">
          <div>
            <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-slate-900">
                  Vendor Response Overview
                </h2>
                <p className="text-[11px] text-slate-500">
                  5 invited suppliers across Excel, PDF, Word, Rate-Card Image, and Email submissions
                </p>
              </div>
              <button
                onClick={() => onNavigate('vendor-responses')}
                className="text-xs font-medium text-[#6161F5] hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span>Open Inbox</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/60 text-[11px] font-medium text-slate-500">
                    <th className="py-2.5 px-4">Vendor</th>
                    <th className="py-2.5 px-3">Response</th>
                    <th className="py-2.5 px-3 text-right">Items Quoted</th>
                    <th className="py-2.5 px-3">Quality Status</th>
                    <th className="py-2.5 px-4 text-right">Extraction Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 text-xs">
                  {vendors.map((v) => {
                    const qual = calculateVendorQualification(v.id, questions, responses);
                    const isExtracted =
                      v.processingStatus === 'extracted_NeedsReview' ||
                      v.processingStatus === 'verified';

                    return (
                      <tr
                        key={v.id}
                        onClick={() => onNavigate('document-intelligence', v.id)}
                        className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">{v.name}</div>
                          <div className="text-[11px] text-slate-400">
                            {v.location} · Lead {v.deliveryLeadTimeDays}d
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="inline-flex items-center gap-1.5 text-slate-700">
                            <DocumentFormatIcon format={v.documentFormat} className="w-3.5 h-3.5" />
                            <span>{v.documentFormat}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800">
                          {isExtracted
                            ? `${v.itemsQuotedCount} / 30`
                            : `${v.itemsQuotedCount} / 30 (Queued)`}
                        </td>
                        <td className="py-3 px-3">
                          {qual.passedAllMandatory ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Qualified ({qual.weightedScore}%)</span>
                            </span>
                          ) : (
                            <TrustBadge type="quality_disqualified" />
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {v.processingStatus === 'unextracted' ? (
                            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-0.5 rounded">
                              Pending Extraction
                            </span>
                          ) : v.processingStatus === 'verified' ? (
                            <TrustBadge type="buyer_verified" />
                          ) : (
                            <span className="text-[11px] font-mono text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                              Extracted ({v.extractionConfidencePct}%)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>
              Click any supplier row to inspect original document & structured fields in Document Intelligence.
            </span>
            {!allExtracted && (
              <button
                onClick={onExtractAllVendors}
                className="font-semibold text-[#6161F5] hover:underline cursor-pointer"
              >
                Process All 5 Submissions &rarr;
              </button>
            )}
          </div>
        </div>

        {/* E. PENDING ACTIONS — Actionable Items Only */}
        <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-lg flex flex-col justify-between">
          <div>
            <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold text-slate-900">Pending Actions</h2>
                <p className="text-[11px] text-slate-500">
                  Items requiring buyer attention prior to award
                </p>
              </div>
              <span className="text-[11px] font-mono font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                4 Action Groups
              </span>
            </div>

            <div className="divide-y divide-slate-200/70 text-xs">
              <button
                onClick={() => onNavigate('bid-comparison', 'missing')}
                className="w-full p-4 text-left hover:bg-slate-50 transition-colors flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-900">
                    Missing vendor quotations (11 slots across 2 vendors)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    PrimePack quoted 27/30 (omitted 027, 028, 030) · EcoWrap quoted 22/30 (omitted 8 custom items).
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              </button>

              <button
                onClick={() => onNavigate('document-intelligence', 'V-SOUTHERN')}
                className="w-full p-4 text-left hover:bg-slate-50 transition-colors flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-900">
                    Low-confidence OCR & conflicting values (2 vendors)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Southern Box angled rate card (61.5% OCR) & PrimePack Item 012 paragraph conflict.
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              </button>

              <button
                onClick={() => onNavigate('document-intelligence', 'V-ECOWRAP')}
                className="w-full p-4 text-left hover:bg-slate-50 transition-colors flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-900">
                    Unresolved unit conversion & historical pricing
                  </div>
                  <div className="text-[11px] text-slate-500">
                    EcoWrap Item 019 quoted per "Pallet Load" & 3 items reference Q3 2025 PO rates.
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              </button>

              <button
                onClick={() => onNavigate('bid-comparison', 'questionnaire')}
                className="w-full p-4 text-left hover:bg-slate-50 transition-colors flex items-start justify-between gap-3 cursor-pointer"
              >
                <div className="space-y-0.5">
                  <div className="font-medium text-slate-900">
                    Questionnaire disqualification & AI spec sign-off
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Southern Box failed mandatory ISO/Bursting check ·{' '}
                    {lineItems.filter((i) => i.approvalStatus === 'ai_generated').length} AI specs to approve.
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              </button>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200/80 bg-slate-50/40">
            <button
              onClick={() => onNavigate('award-recommendations')}
              className="w-full py-2 px-3 text-xs font-medium text-white bg-[#32323A] hover:bg-slate-800 rounded-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Proceed to Award Recommendation</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW: F. RECENT ACTIVITY & SPEND BENCHMARK */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Spend Benchmark Summary */}
        <div className="lg:col-span-6 bg-white border border-slate-200/90 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold text-slate-900">
                Award Scenario Spend Comparison (₹ Lakhs)
              </h2>
              <p className="text-[11px] text-slate-500">
                2026 Baseline ({formatLakhs(totalBaselineValue)}) vs. Single-Vendor & Optimal QA Split
              </p>
            </div>
            <button
              onClick={() => onNavigate('scenario-simulator')}
              className="text-xs font-medium text-[#6161F5] hover:underline cursor-pointer"
            >
              Simulate Scenarios &rarr;
            </button>
          </div>
          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={spendBenchmarkData}
                layout="vertical"
                margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4E4E7" />
                <XAxis
                  type="number"
                  domain={[310, 390]}
                  tick={{ fontSize: 11, fill: '#71717A' }}
                  tickFormatter={(v) => `₹${v}L`}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={90}
                  tick={{ fontSize: 11, fill: '#18181B', fontWeight: 500 }}
                />
                <Tooltip
                  formatter={(val) => [
                    `₹${Number(val ?? 0).toFixed(2)} Lakhs`,
                    'Total Spend',
                  ]}
                  contentStyle={{ fontSize: '11px', borderRadius: '6px', borderColor: '#E4E4E7' }}
                />
                <Bar dataKey="lakhs" radius={[0, 4, 4, 0]} barSize={18}>
                  {spendBenchmarkData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* F. RECENT ACTIVITY CHRONOLOGICAL FEED */}
        <div className="lg:col-span-6 bg-white border border-slate-200/90 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-xs font-semibold text-slate-900">Recent Activity</h2>
              <p className="text-[11px] text-slate-500">
                Chronological sourcing & document audit trail
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">IST (UTC+5:30)</span>
          </div>

          <div className="divide-y divide-slate-100 text-xs">
            {[
              {
                time: 'Nov 04 · 16:08',
                event: 'EcoWrap Packaging submitted inline email quotation (.eml)',
                meta: '22 of 30 items quoted · 3 historical 2025 rate references flagged',
              },
              {
                time: 'Nov 04 · 11:50',
                event: 'Southern Box Mfg. uploaded signed rate-card photograph (.jpg)',
                meta: 'Disqualified on mandatory ISO 9001 & 14 kg/cm² Bursting QA gate',
              },
              {
                time: 'Nov 04 · 09:15',
                event: 'PrimePack Solutions submitted narrative proposal (.docx)',
                meta: '27 of 30 items extracted from paragraphs · Ex-Works +3.5% freight rule applied',
              },
              {
                time: 'Nov 03 · 17:45',
                event: 'Global Corrugators (.pdf) & Apex Packaging (.xlsx) bids logged',
                meta: 'Page-3 4.5% volume discount footnote & bundle UOM conversions detected',
              },
              {
                time: 'Oct 28 · 10:00',
                event: 'RFQ-AER-HYD-2026-089 published to 5 packaging suppliers',
                meta: '30 corrugated packaging SKUs · Net 45 Days · 15-Day Delivery SLA',
              },
            ].map((act, idx) => (
              <div key={idx} className="py-2.5 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{act.event}</div>
                  <div className="text-[11px] text-slate-500 truncate">{act.meta}</div>
                </div>
                <span className="text-[11px] font-mono text-slate-400 shrink-0">
                  {act.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
