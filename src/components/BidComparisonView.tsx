import React, { useState } from 'react';
import {
  Search,
  Download,
  ArrowUpDown,
  Play,
  CheckCircle2,
} from 'lucide-react';
import {
  LineItem,
  Vendor,
  VendorQuoteCell,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  ConversionRule,
} from '../types/procurement';
import {
  calculateVendorQualification,
  getEffectiveCellPriceInr,
  formatInr,
  formatLakhs,
} from '../services/procurementEngine';
import { TrustBadge } from './GovernanceUI';

interface BidComparisonViewProps {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  conversionRules: ConversionRule[];
  initialFilterHint?: string;
  onOpenCellEvidence: (itemId: string, vendorId: string) => void;
  onExtractAllVendors: () => void;
  onToggleMandatoryQuestion: (questionId: string) => void;
  onExportMatrixCsv: () => void;
}

export const BidComparisonView: React.FC<BidComparisonViewProps> = ({
  lineItems,
  vendors,
  quoteCells,
  questions,
  responses,
  conversionRules,
  initialFilterHint,
  onOpenCellEvidence,
  onExtractAllVendors,
  onToggleMandatoryQuestion,
  onExportMatrixCsv,
}) => {
  const [activeTab, setActiveTab] = useState<'matrix' | 'questionnaire' | 'normalisation'>(
    initialFilterHint === 'questionnaire' ? 'questionnaire' : 'matrix'
  );
  const [quickFilter, setQuickFilter] = useState<
    'all' | 'qualified' | 'lowest_price' | 'missing' | 'exceptions'
  >(initialFilterHint === 'missing' ? 'missing' : 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [enforceQualityGate, setEnforceQualityGate] = useState(true);
  const [sortBy, setSortBy] = useState<'id' | 'qty' | 'lowestPrice' | 'spend'>('id');
  const [sortAsc, setSortAsc] = useState(true);

  const qualifiedCount = vendors.filter((v) => calculateVendorQualification(v.id, questions, responses).passedAllMandatory).length;
  const extractedVendorsCount = vendors.filter(
    (v) => v.processingStatus === 'extracted_NeedsReview' || v.processingStatus === 'verified'
  ).length;

  const vendorQualMap = new Map<string, ReturnType<typeof calculateVendorQualification>>();
  vendors.forEach((v) => {
    vendorQualMap.set(v.id, calculateVendorQualification(v.id, questions, responses));
  });

  const visibleVendors = vendors.filter((v) => {
    if (quickFilter === 'qualified') {
      return vendorQualMap.get(v.id)?.passedAllMandatory ?? true;
    }
    return true;
  });

  // Build enriched rows
  const enrichedRows = lineItems.map((item) => {
    const itemCells = vendors.map((v) => {
      const cell = quoteCells.find((c) => c.itemId === item.id && c.vendorId === v.id)!;
      const qual = vendorQualMap.get(v.id)!;
      const eff = getEffectiveCellPriceInr(cell, v);
      const isQualityEligible = !enforceQualityGate || qual.passedAllMandatory;
      const isEligibleForAward =
        eff.priceInr !== null && eff.isComparable && isQualityEligible;

      return {
        vendor: v,
        cell,
        qual,
        effPriceInr: eff.priceInr,
        isComparable: eff.isComparable,
        hasAssumption: eff.hasUnresolvedAssumption,
        isQualityEligible,
        isEligibleForAward,
      };
    });

    const eligibleBids = itemCells
      .filter((c) => c.isEligibleForAward && c.effPriceInr !== null)
      .sort((a, b) => (a.effPriceInr ?? Infinity) - (b.effPriceInr ?? Infinity));

    const lowestEligible = eligibleBids[0] || null;
    const hasMissing = itemCells.some((c) => !c.cell.quoted);
    const hasBlockedOrException = itemCells.some(
      (c) =>
        (c.cell.quoted && !c.cell.isComparable && !c.cell.buyerVerified) ||
        (c.cell.validationStatus === 'low_confidence' && !c.cell.buyerVerified)
    );

    return {
      item,
      itemCells,
      lowestEligiblePriceInr: lowestEligible?.effPriceInr ?? null,
      lowestEligibleVendor: lowestEligible?.vendor ?? null,
      hasMissing,
      hasBlockedOrException,
    };
  });

  // Summary metrics above the matrix
  const totalBaseline = lineItems.reduce(
    (s, i) => s + i.quantity * i.baselineUnitPriceInr,
    0
  );
  const totalLowestEligibleSpend = enrichedRows.reduce((s, r) => {
    const unit = r.lowestEligiblePriceInr ?? r.item.baselineUnitPriceInr;
    return s + unit * r.item.quantity;
  }, 0);
  const totalSavings = totalBaseline - totalLowestEligibleSpend;
  const savingsPct =
    totalBaseline > 0 ? ((totalSavings / totalBaseline) * 100).toFixed(2) : '0.00';

  const filteredRows = enrichedRows
    .filter((row) => {
      if (categoryFilter !== 'ALL' && row.item.category !== categoryFilter) return false;
      if (quickFilter === 'missing' && !row.hasMissing) return false;
      if (quickFilter === 'exceptions' && !row.hasBlockedOrException) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = row.item.id.toLowerCase().includes(q);
        const matchDesc = row.item.description.toLowerCase().includes(q);
        const matchCode = row.item.code.toLowerCase().includes(q);
        if (!matchId && !matchDesc && !matchCode) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (quickFilter === 'lowest_price') {
        return (a.lowestEligiblePriceInr ?? 999999) - (b.lowestEligiblePriceInr ?? 999999);
      }
      let cmp = 0;
      if (sortBy === 'id') {
        cmp = a.item.id.localeCompare(b.item.id);
      } else if (sortBy === 'qty') {
        cmp = a.item.quantity - b.item.quantity;
      } else if (sortBy === 'lowestPrice') {
        cmp = (a.lowestEligiblePriceInr ?? 999999) - (b.lowestEligiblePriceInr ?? 999999);
      } else if (sortBy === 'spend') {
        cmp =
          a.item.quantity * a.item.baselineUnitPriceInr -
          b.item.quantity * b.item.baselineUnitPriceInr;
      }
      return sortAsc ? cmp : -cmp;
    });

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Bid Comparison
            </h1>
            <span className="text-xs font-mono text-slate-400">
              30 Line Items × 5 Suppliers · DDP Pashamylaram (INR Excl. GST)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Standardised side-by-side commercial evaluation with mandatory quality gate enforcement
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {extractedVendorsCount < vendors.length && (
            <button
              onClick={onExtractAllVendors}
              className="px-3 py-1.5 text-xs font-medium text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-amber-700 text-amber-700" />
              <span>Extract Pending Bids ({5 - extractedVendorsCount})</span>
            </button>
          )}

          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md">
            <button
              onClick={() => setActiveTab('matrix')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                activeTab === 'matrix'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Comparison Matrix (30)
            </button>
            <button
              onClick={() => setActiveTab('questionnaire')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                activeTab === 'questionnaire'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Questionnaire (12)
            </button>
            <button
              onClick={() => setActiveTab('normalisation')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                activeTab === 'normalisation'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Normalisation ({conversionRules.length})
            </button>
          </div>

          <button
            onClick={onExportMatrixCsv}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Compact Summary Bar Above Matrix */}
      <div className="bg-white border border-slate-200/90 rounded-lg grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 text-xs">
        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-400">Baseline Portfolio Value</div>
          <div className="text-sm font-semibold font-mono text-slate-900 mt-0.5">
            {formatLakhs(totalBaseline)}{' '}
            <span className="text-[11px] font-normal text-slate-400">
              ({formatInr(totalBaseline)})
            </span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-400">Lowest Eligible Split</div>
          <div className="text-sm font-semibold font-mono text-slate-900 mt-0.5">
            {extractedVendorsCount > 0 ? formatLakhs(totalLowestEligibleSpend) : 'Pending Extract'}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-400">Potential Savings</div>
          <div className="text-sm font-semibold font-mono text-emerald-700 mt-0.5">
            {extractedVendorsCount > 0
              ? `${formatLakhs(totalSavings)} (${savingsPct}%)`
              : 'Pending extraction'}
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="text-[11px] text-slate-400">Quality Eligibility</div>
          <div className="text-sm font-semibold text-slate-900 mt-0.5">
            {qualifiedCount} Qualified · <span className="text-rose-700 font-normal">{vendors.length - qualifiedCount} Disqualified</span>
          </div>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400">Mandatory QA Gate</div>
            <div className="text-xs font-medium text-slate-800 mt-0.5">
              {enforceQualityGate ? 'Enforced' : 'Overridden'}
            </div>
          </div>
          <input
            type="checkbox"
            checked={enforceQualityGate}
            onChange={(e) => setEnforceQualityGate(e.target.checked)}
            className="rounded border-slate-300 text-[#6161F5] cursor-pointer"
            title="Toggle Mandatory Quality Gate"
          />
        </div>
      </div>

      {/* TAB 1: 30x5 COMPARISON MATRIX */}
      {activeTab === 'matrix' && (
        <div className="bg-white border border-slate-200/90 rounded-lg overflow-hidden">
          {/* Filter Bar Above Table (Section 8 Requirements) */}
          <div className="px-4 py-3 border-b border-slate-200/80 bg-slate-50/50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'All Vendors' },
                  { id: 'qualified', label: 'Qualified Vendors (4)' },
                  { id: 'lowest_price', label: 'Lowest Price' },
                  { id: 'missing', label: 'Missing Quotes' },
                  { id: 'exceptions', label: 'Exceptions' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  onClick={() => setQuickFilter(pill.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                    quickFilter === pill.id
                      ? 'bg-[#32323A] text-white border-[#32323A]'
                      : 'bg-white text-slate-600 border-slate-200/90 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-52">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter SKU or item..."
                  className="w-full pl-8 pr-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-[#6161F5]"
                />
              </div>

              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md text-slate-700"
              >
                <option value="ALL">All Categories (30)</option>
                <option value="5-Ply Corrugated Boxes">5-Ply Corrugated Boxes</option>
                <option value="3-Ply Corrugated Boxes">3-Ply Corrugated Boxes</option>
                <option value="Shipping Cartons">Shipping Cartons</option>
                <option value="Protective Packaging">Protective Packaging</option>
                <option value="Corrugated Sheets">Corrugated Sheets</option>
                <option value="Custom-Sized Cartons">Custom-Sized Cartons</option>
                <option value="Packaging Rolls">Packaging Rolls</option>
                <option value="Die-Cut & Partition Inserts">Die-Cut & Partition Inserts</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as 'id' | 'qty' | 'lowestPrice' | 'spend')
                }
                aria-label="Sort matrix by column"
                className="px-2.5 py-1 text-xs bg-white border border-slate-300 rounded-md text-slate-700"
              >
                <option value="id">Sort: Item ID</option>
                <option value="spend">Sort: Baseline Spend</option>
                <option value="lowestPrice">Sort: Lowest Unit Price</option>
                <option value="qty">Sort: Annual Quantity</option>
              </select>

              <button
                onClick={() => setSortAsc(!sortAsc)}
                className="px-2.5 py-1 text-xs text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                title="Toggle Ascending / Descending Sort"
              >
                <ArrowUpDown className="w-3 h-3" />
                <span>{sortAsc ? 'Asc' : 'Desc'}</span>
              </button>
            </div>
          </div>

          {/* High-Density Matrix with Sticky Header and Sticky First Two Columns */}
          <div className="overflow-x-auto max-h-[640px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-20 bg-slate-50 border-b border-slate-200 text-[11px] font-medium text-slate-500">
                <tr>
                  <th className="sticky left-0 z-30 bg-slate-50 py-2.5 px-3 w-[104px] min-w-[104px] border-r border-slate-200/80">
                    Item ID
                  </th>
                  <th className="sticky left-[104px] z-30 bg-slate-50 py-2.5 px-3 w-[230px] min-w-[230px] border-r border-slate-200 sticky-col-shadow">
                    Product
                  </th>
                  <th className="py-2.5 px-2.5 text-right whitespace-nowrap">Qty</th>
                  <th className="py-2.5 px-2 border-r border-slate-200/70">UOM</th>
                  {visibleVendors.map((v) => {
                    const qual = vendorQualMap.get(v.id);
                    return (
                      <th
                        key={v.id}
                        className="py-2 px-3 text-right border-r border-slate-200/70 min-w-[136px]"
                      >
                        <div className="text-slate-800 font-semibold">{v.shortName}</div>
                        <div className="text-[10px] font-mono font-normal text-slate-400">
                          {v.itemsQuotedCount}/30 · {v.deliveryLeadTimeDays}d ·{' '}
                          {qual?.passedAllMandatory ? (
                            <span className="text-emerald-600 font-sans">
                              QA {qual.weightedScore}%
                            </span>
                          ) : (
                            <span className="text-rose-600 font-sans font-medium">
                              Disqualified
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                  <th className="py-2.5 px-3 text-right border-r border-slate-200/70 whitespace-nowrap text-slate-800">
                    Lowest Eligible
                  </th>
                  <th className="py-2.5 px-3 border-r border-slate-200/70 whitespace-nowrap text-slate-800">
                    Best Supplier
                  </th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 text-xs">
                {filteredRows.map((row) => {
                  const { item, itemCells, lowestEligiblePriceInr, lowestEligibleVendor } = row;
                  return (
                    <tr key={item.id} className="group hover:bg-slate-50/80 transition-colors">
                      {/* Sticky Col 1: Item ID */}
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-slate-50 py-2.5 px-3 font-mono font-medium text-slate-900 border-r border-slate-200/70 whitespace-nowrap">
                        <div>{item.id}</div>
                        <div className="text-[10px] text-slate-400">{item.code}</div>
                      </td>

                      {/* Sticky Col 2: Product */}
                      <td className="sticky left-[104px] z-10 bg-white group-hover:bg-slate-50 py-2.5 px-3 border-r border-slate-200 sticky-col-shadow">
                        <div className="font-medium text-slate-900 truncate max-w-[210px]" title={item.description}>
                          {item.description}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[210px]">
                          {item.category} · Base ₹{item.baselineUnitPriceInr.toFixed(2)}
                        </div>
                      </td>

                      <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {item.quantity.toLocaleString('en-IN')}
                      </td>

                      <td className="py-2.5 px-2 text-slate-400 border-r border-slate-200/60 whitespace-nowrap">
                        {item.standardUom}
                      </td>

                      {/* Vendor Quote Cells */}
                      {itemCells
                        .filter((c) => visibleVendors.some((v) => v.id === c.vendor.id))
                        .map((c) => {
                          const isLowestEligible =
                            lowestEligibleVendor?.id === c.vendor.id &&
                            lowestEligiblePriceInr !== null;
                          const isVendorUnextracted =
                            c.vendor.processingStatus === 'unextracted';

                          return (
                            <td
                              key={c.vendor.id}
                              onClick={() => onOpenCellEvidence(item.id, c.vendor.id)}
                              title="Click to inspect source document and normalisation formula"
                              className={`py-2 px-3 text-right font-mono tabular-nums border-r border-slate-200/60 cursor-pointer transition-colors whitespace-nowrap ${
                                isLowestEligible
                                  ? 'bg-emerald-50/70 font-semibold text-emerald-900'
                                  : !c.qual.passedAllMandatory
                                  ? 'text-slate-400 hover:bg-slate-100/60'
                                  : 'text-slate-800 hover:bg-[#6161F5]/[0.05]'
                              }`}
                            >
                              {isVendorUnextracted ? (
                                <span className="text-[11px] font-sans text-slate-400">
                                  Pending
                                </span>
                              ) : !c.cell.quoted ? (
                                <span className="text-[11px] font-sans text-slate-300">
                                  —
                                </span>
                              ) : !c.cell.isComparable && !c.cell.buyerVerified ? (
                                <div>
                                  <span className="text-[11px] font-sans text-rose-600 font-medium">
                                    Blocked
                                  </span>
                                  <div className="text-[10px] text-slate-400">
                                    ₹{c.cell.provisionalUnitPriceInr?.toFixed(2)}*
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="flex items-center justify-end gap-1">
                                    <span>₹{c.effPriceInr?.toFixed(2)}</span>
                                    {isLowestEligible && (
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                    )}
                                  </div>
                                  <div className="text-[10px] font-sans text-slate-400">
                                    {c.cell.rawCurrency === 'USD' && 'USD '}
                                    {c.cell.conversionFactorToStandard !== 1 &&
                                      c.cell.rawCurrency !== 'USD' &&
                                      'UOM '}
                                    {c.cell.discountAppliedPct > 0 && '-4.5% '}
                                    {c.cell.freightAdjustmentPct > 0 &&
                                      `+${c.cell.freightAdjustmentPct}% `}
                                    {c.cell.validationStatus === 'low_confidence' &&
                                      !c.cell.buyerVerified && (
                                        <span className="text-amber-600">Low OCR</span>
                                      )}
                                    {!c.qual.passedAllMandatory && (
                                      <span className="text-rose-500">QA Disq.</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          );
                        })}

                      {/* Lowest Eligible Price */}
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-emerald-700 border-r border-slate-200/60 whitespace-nowrap">
                        {lowestEligiblePriceInr !== null
                          ? `₹${lowestEligiblePriceInr.toFixed(2)}`
                          : '—'}
                      </td>

                      {/* Best Supplier */}
                      <td className="py-2.5 px-3 font-medium text-slate-900 border-r border-slate-200/60 whitespace-nowrap">
                        {lowestEligibleVendor ? (
                          <div>
                            <div>{lowestEligibleVendor.shortName}</div>
                            <div className="text-[10px] font-mono text-emerald-600">
                              -₹
                              {(
                                item.baselineUnitPriceInr - (lowestEligiblePriceInr ?? 0)
                              ).toFixed(2)}
                              /{item.standardUom}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px]">Pending</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {extractedVendorsCount === 0 ? (
                          <TrustBadge type="requires_clarification" labelOverride="Pending" />
                        ) : row.hasBlockedOrException ? (
                          <TrustBadge type="requires_clarification" labelOverride="Exception" />
                        ) : row.hasMissing ? (
                          <TrustBadge type="source_verified" labelOverride="Partial" />
                        ) : (
                          <TrustBadge type="buyer_verified" labelOverride="Comparable" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: VENDOR QUESTIONNAIRE EVALUATION */}
      {activeTab === 'questionnaire' && (
        <div className="bg-white border border-slate-200/90 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                12-Criterion Technical & Quality Qualification Matrix
              </h3>
              <p className="text-[11px] text-slate-500">
                Outcomes below use the sample questionnaire answers supplied with the project (not read from vendor files, not buyer-verified). A supplier that fails a mandatory question is excluded from awards while the gate is enforced.
              </p>
            </div>
            <span className="text-[11px] text-slate-500">
              Click any Mandatory Gate pill to toggle enforcement
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-4 w-64">Criterion</th>
                  <th className="py-2.5 px-2.5 text-center">Gate</th>
                  {vendors.map((v) => {
                    const qual = vendorQualMap.get(v.id);
                    return (
                      <th key={v.id} className="py-2.5 px-3 min-w-[175px]">
                        <div className="text-slate-900 font-semibold">{v.shortName}</div>
                        <div className="text-[10px] font-mono">
                          {qual?.weightedScore}% ·{' '}
                          {qual?.passedAllMandatory ? (
                            <span className="text-emerald-600">Qualified</span>
                          ) : (
                            <span className="text-rose-600">Disqualified</span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {questions.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 align-top">
                      <div className="font-medium text-slate-900">
                        {q.id}: {q.questionText}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {q.minimumRequirementDescription} ({q.weightPct}%)
                      </div>
                    </td>
                    <td className="py-3 px-2.5 align-top text-center">
                      <button
                        onClick={() => onToggleMandatoryQuestion(q.id)}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded border cursor-pointer ${
                          q.mandatoryCriterion
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {q.mandatoryCriterion ? 'Mandatory' : 'Weighted'}
                      </button>
                    </td>
                    {vendors.map((v) => {
                      const resp = responses.find(
                        (r) => r.questionId === q.id && r.vendorId === v.id
                      );
                      const failedGate =
                        q.mandatoryCriterion && resp && !resp.passedMandatoryCheck;
                      return (
                        <td
                          key={v.id}
                          className={`py-3 px-3 align-top ${
                            failedGate ? 'bg-rose-50/50' : ''
                          }`}
                        >
                          {resp ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span
                                  className={`font-mono font-semibold text-[11px] ${
                                    failedGate
                                      ? 'text-rose-700'
                                      : resp.scoreOutOf100 >= 85
                                      ? 'text-emerald-700'
                                      : 'text-slate-700'
                                  }`}
                                >
                                  {failedGate ? 'FAIL (Hard Gate)' : `${resp.scoreOutOf100}/100`}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-600 leading-snug">
                                {resp.answerText}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: NORMALISATION SUMMARY */}
      {activeTab === 'normalisation' && (
        <div className="bg-white border border-slate-200/90 rounded-lg p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            {conversionRules.map((r) => (
              <div
                key={r.id}
                className="p-3.5 rounded-lg border border-slate-200/80 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-slate-900">
                    {r.id} · {r.category}
                  </span>
                  <TrustBadge
                    type={
                      r.verificationStatus === 'Buyer Verified'
                        ? 'buyer_verified'
                        : r.verificationStatus === 'Blocked (Ambiguous)'
                        ? 'not_comparable'
                        : 'requires_clarification'
                    }
                    labelOverride={r.verificationStatus}
                  />
                </div>
                <div className="font-medium text-slate-800">
                  {r.originalValueDisplay} &rarr; {r.standardisedValueDisplay}
                </div>
                <div className="font-mono text-[11px] text-slate-500">
                  {r.conversionFormula}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
