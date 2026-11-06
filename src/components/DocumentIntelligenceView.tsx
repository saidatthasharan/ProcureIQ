import React, { useState } from 'react';
import {
  Play,
  Check,
  FileSearch,
} from 'lucide-react';
import {
  Vendor,
  LineItem,
  VendorQuoteCell,
  ExtractionException,
  ConversionRule,
} from '../types/procurement';
import { TrustBadge, DocumentFormatIcon } from './GovernanceUI';

interface DocumentIntelligenceViewProps {
  vendors: Vendor[];
  lineItems: LineItem[];
  quoteCells: VendorQuoteCell[];
  exceptions: ExtractionException[];
  conversionRules: ConversionRule[];
  selectedVendorId: string;
  onSelectVendor: (vendorId: string) => void;
  onExtractVendor: (vendorId: string) => void;
  onExtractAllVendors: () => void;
  onResolveException: (exceptionId: string, resolutionValueInr?: number) => void;
  onVerifyConversionRule: (ruleId: string) => void;
  onOpenCellEvidence: (itemId: string, vendorId: string) => void;
}

export const DocumentIntelligenceView: React.FC<DocumentIntelligenceViewProps> = ({
  vendors,
  lineItems,
  quoteCells,
  exceptions,
  conversionRules,
  selectedVendorId,
  onSelectVendor,
  onExtractVendor,
  onExtractAllVendors,
  onResolveException,
  onVerifyConversionRule,
  onOpenCellEvidence,
}) => {
  const [activeSubView, setActiveSubView] = useState<
    'split-workspace' | 'exception-queue' | 'standardisation-engine'
  >('split-workspace');
  const [fieldFilter, setFieldFilter] = useState<
    'ALL' | 'verified' | 'low_confidence' | 'missing' | 'unresolved'
  >('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | 'Critical' | 'Warning' | 'Info'>(
    'ALL'
  );
  const [inspectedItemId, setInspectedItemId] = useState<string>('PKG-HYD-012');

  const activeVendor = vendors.find((v) => v.id === selectedVendorId) || vendors[0];
  const isVendorExtracted =
    activeVendor.processingStatus === 'extracted_NeedsReview' ||
    activeVendor.processingStatus === 'verified';

  const inspectedCell =
    quoteCells.find(
      (c) => c.vendorId === activeVendor.id && c.itemId === inspectedItemId
    ) ||
    quoteCells.find((c) => c.vendorId === activeVendor.id) ||
    null;
  const inspectedItem = lineItems.find((i) => i.id === inspectedCell?.itemId) || null;

  const vendorCells = quoteCells
    .filter((c) => c.vendorId === activeVendor.id)
    .filter((c) => {
      if (fieldFilter === 'ALL') return true;
      if (fieldFilter === 'verified')
        return c.buyerVerified || (c.quoted && c.isComparable && c.confidencePct >= 85);
      if (fieldFilter === 'low_confidence')
        return c.validationStatus === 'low_confidence' && !c.buyerVerified;
      if (fieldFilter === 'missing') return !c.quoted;
      if (fieldFilter === 'unresolved')
        return c.quoted && (!c.isComparable || c.validationStatus === 'footnote_discount_applied');
      return true;
    });

  const openExceptionsCount = exceptions.filter(
    (e) => e.status !== 'Resolved (Buyer Verified)'
  ).length;
  const unverifiedRulesCount = conversionRules.filter(
    (r) => r.verificationStatus !== 'Buyer Verified'
  ).length;

  const filteredExceptions = exceptions.filter((exc) => {
    if (severityFilter !== 'ALL' && exc.severity !== severityFilter) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Document Intelligence
            </h1>
            <span className="text-xs font-mono text-slate-400">
              Source-to-Field Verification & Standardisation
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Inspect original vendor documents alongside extracted structured pricing, OCR confidence, and conversion rules
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md">
            <button
              onClick={() => setActiveSubView('split-workspace')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                activeSubView === 'split-workspace'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Document Review
            </button>
            <button
              onClick={() => setActiveSubView('exception-queue')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                activeSubView === 'exception-queue'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Exceptions ({openExceptionsCount})
            </button>
            <button
              onClick={() => setActiveSubView('standardisation-engine')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                activeSubView === 'standardisation-engine'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Standardisation ({conversionRules.length})
            </button>
          </div>

          <button
            onClick={onExtractAllVendors}
            className="px-3 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-white" />
            <span>Process All 5 Docs</span>
          </button>
        </div>
      </div>

      {/* Compact 5-Vendor Selector Bar */}
      <div className="bg-white border border-slate-200/90 rounded-lg grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80 overflow-hidden">
        {vendors.map((v) => {
          const isSelected = v.id === activeVendor.id;
          const vExcs = exceptions.filter(
            (e) => e.vendorId === v.id && e.status !== 'Resolved (Buyer Verified)'
          ).length;
          const extracted =
            v.processingStatus === 'extracted_NeedsReview' || v.processingStatus === 'verified';

          return (
            <button
              key={v.id}
              onClick={() => {
                onSelectVendor(v.id);
                if (activeSubView !== 'split-workspace') {
                  setActiveSubView('split-workspace');
                }
              }}
              className={`p-3 text-left transition-colors cursor-pointer ${
                isSelected
                  ? 'bg-[#6161F5]/[0.05] border-b-2 border-b-[#6161F5]'
                  : 'hover:bg-slate-50/80'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 truncate">
                  <DocumentFormatIcon format={v.documentFormat} className="w-3.5 h-3.5" />
                  <span className="truncate">{v.shortName}</span>
                </div>
                <span className="text-[10px] font-mono text-slate-400">
                  {v.documentFormat.split(' ')[0]}
                </span>
              </div>
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="font-mono text-slate-500">
                  {extracted ? `${v.itemsQuotedCount}/30 · ${v.extractionConfidencePct}%` : 'Unextracted'}
                </span>
                {vExcs > 0 && (
                  <span className="text-amber-700 font-medium">{vExcs} issues</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* VIEW 1: TWO-PANEL DOCUMENT REVIEW INTERFACE */}
      {activeSubView === 'split-workspace' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT PANEL: Original Vendor Document */}
          <div className="lg:col-span-5 bg-white border border-slate-200/90 rounded-lg flex flex-col h-[660px] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200/80 bg-slate-50/50 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {activeVendor.documentFileName}
                </div>
                <div className="text-[11px] text-slate-500">
                  {activeVendor.documentFormat} · {activeVendor.itemsQuotedCount}/30 Quoted · {activeVendor.submissionTimestamp}
                </div>
              </div>
              {!isVendorExtracted && (
                <button
                  onClick={() => onExtractVendor(activeVendor.id)}
                  className="px-2.5 py-1 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded cursor-pointer shrink-0"
                >
                  Extract Document
                </button>
              )}
            </div>

            <div className="p-4 bg-[#18181B] text-slate-200 flex-1 overflow-y-auto space-y-4 font-mono text-xs">
              {/* Live Synchronized Source-to-Field Spotlight */}
              {inspectedCell && (
                <div className="p-3 rounded-md bg-[#6161F5]/15 border border-[#6161F5]/50 space-y-2 font-sans">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-300 font-semibold">
                      Active Source-to-Field Trace · {inspectedCell.itemId}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-emerald-400">
                      {inspectedCell.confidencePct}% OCR Conf.
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-white">
                    {inspectedItem?.description} ({inspectedItem?.code})
                  </div>
                  <div className="p-2 rounded bg-slate-950/90 border border-slate-800 font-mono text-[11px] text-amber-300 leading-relaxed">
                    <div className="text-[10px] text-slate-400 mb-0.5">
                      Coordinate: {inspectedCell.sourceReference}
                    </div>
                    "{inspectedCell.sourceSnippet}"
                  </div>
                  <div className="flex items-center justify-between pt-1 text-[11px]">
                    <span className="text-slate-300 font-mono">
                      Raw:{' '}
                      {inspectedCell.quoted
                        ? inspectedCell.rawQuotedPrice !== null
                          ? `${inspectedCell.rawCurrency === 'USD' ? '$' : '₹'}${inspectedCell.rawQuotedPrice} / ${inspectedCell.rawUom}`
                          : 'Q3 2025 PO Ref'
                        : 'Not Quoted'}{' '}
                      &rarr; Norm:{' '}
                      <strong className="text-white">
                        {inspectedCell.normalisedUnitPriceInr !== null
                          ? `₹${inspectedCell.normalisedUnitPriceInr.toFixed(2)}`
                          : inspectedCell.provisionalUnitPriceInr !== null
                          ? `₹${inspectedCell.provisionalUnitPriceInr.toFixed(2)} (Blocked)`
                          : '—'}
                      </strong>
                    </span>
                    <button
                      onClick={() => onOpenCellEvidence(inspectedCell.itemId, activeVendor.id)}
                      className="px-2 py-0.5 text-[11px] font-medium bg-[#6161F5] hover:bg-[#4F4FE0] text-white rounded cursor-pointer"
                    >
                      Verify / Edit &rarr;
                    </button>
                  </div>
                </div>
              )}

              <div className="p-2.5 bg-slate-900 border border-slate-800 rounded text-[11px] text-slate-300 leading-relaxed font-sans">
                <strong className="text-white">Format Scenario:</strong>{' '}
                {activeVendor.documentScenarioSummary}
              </div>

              {activeVendor.id === 'V-APEX' && (
                <div className="border border-slate-800 rounded overflow-hidden text-[11px]">
                  <div className="bg-slate-900 px-3 py-1.5 text-slate-400 border-b border-slate-800 flex justify-between">
                    <span>Worksheet: Commercial_Bid_HYD</span>
                    <span>Modified Column E</span>
                  </div>
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-900/60 text-slate-400 border-b border-slate-800">
                        <th className="p-2">Row</th>
                        <th className="p-2">SKU</th>
                        <th className="p-2">Billing Unit</th>
                        <th className="p-2 text-right">Quoted Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      <tr
                        onClick={() => setInspectedItemId('PKG-HYD-001')}
                        className="cursor-pointer hover:bg-slate-800/60"
                      >
                        <td className="p-2 text-slate-500">09</td>
                        <td className="p-2">CB5-EXP-6040</td>
                        <td className="p-2">Box</td>
                        <td className="p-2 text-right text-emerald-400">₹88.35</td>
                      </tr>
                      <tr
                        onClick={() => setInspectedItemId('PKG-HYD-007')}
                        className="bg-amber-950/30 cursor-pointer hover:bg-amber-950/50"
                      >
                        <td className="p-2 text-amber-400">15</td>
                        <td className="p-2 text-amber-200">CB3-STD-3020</td>
                        <td className="p-2 text-amber-300">100 Pieces</td>
                        <td className="p-2 text-right text-amber-300">₹1,780.00</td>
                      </tr>
                      <tr
                        onClick={() => setInspectedItemId('PKG-HYD-008')}
                        className="bg-amber-950/30 cursor-pointer hover:bg-amber-950/50"
                      >
                        <td className="p-2 text-amber-400">16</td>
                        <td className="p-2 text-amber-200">CB3-FAS-2518</td>
                        <td className="p-2 text-amber-300">100 Pieces</td>
                        <td className="p-2 text-right text-amber-300">₹1,440.00</td>
                      </tr>
                      <tr
                        onClick={() => setInspectedItemId('PKG-HYD-021')}
                        className="bg-amber-950/30 cursor-pointer hover:bg-amber-950/50"
                      >
                        <td className="p-2 text-amber-400">29</td>
                        <td className="p-2 text-amber-200">SHT-SLP-1210</td>
                        <td className="p-2 text-amber-300">Metric Tonne</td>
                        <td className="p-2 text-right text-amber-300">₹59,500.00</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {activeVendor.id === 'V-GLOBAL' && (
                <div className="p-3.5 bg-white text-slate-900 rounded border border-slate-300 space-y-3 font-sans">
                  <div className="border-b border-slate-200 pb-2 flex justify-between items-center">
                    <div>
                      <div className="font-bold text-xs">GLOBAL CORRUGATORS LTD.</div>
                      <div className="text-[10px] text-slate-500">Page 3 of 3 · Sri City SEZ</div>
                    </div>
                    <span className="text-[10px] font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                      PDF Commercial Table
                    </span>
                  </div>
                  <div className="text-[11px] font-mono space-y-1">
                    <div
                      onClick={() => setInspectedItemId('PKG-HYD-001')}
                      className="flex justify-between py-1 border-b border-slate-100 cursor-pointer hover:bg-slate-50 px-1"
                    >
                      <span>PKG-HYD-001 (5-Ply Export)</span>
                      <span className="text-[#6161F5] font-semibold">$1.08 USD / Box *</span>
                    </div>
                    <div
                      onClick={() => setInspectedItemId('PKG-HYD-002')}
                      className="flex justify-between py-1 border-b border-slate-100 cursor-pointer hover:bg-slate-50 px-1"
                    >
                      <span>PKG-HYD-002 (5-Ply Valve Box)</span>
                      <span className="text-[#6161F5] font-semibold">$0.83 USD / Box *</span>
                    </div>
                    <div
                      onClick={() => setInspectedItemId('PKG-HYD-014')}
                      className="flex justify-between py-1 border-b border-slate-100 cursor-pointer hover:bg-slate-50 px-1"
                    >
                      <span>PKG-HYD-014 (UN-4G Carton)</span>
                      <span>₹96.72 INR / Box *</span>
                    </div>
                  </div>
                  <div className="p-2.5 bg-amber-50 border border-amber-300 rounded text-[11px] text-amber-950">
                    <strong>Footnote * (Page 3 Footer):</strong> "A flat 4.5% commercial volume discount applies across all line items when aggregate RFQ award exceeds ₹25,00,000."
                  </div>
                </div>
              )}

              {activeVendor.id === 'V-PRIMEPACK' && (
                <div className="p-3.5 bg-white text-slate-900 rounded border border-slate-300 space-y-2.5 font-sans text-xs leading-relaxed">
                  <div className="border-b border-slate-200 pb-1.5 font-semibold text-slate-800">
                    Section 2.4 — Narrative Commercial Proposal (.docx)
                  </div>
                  <p className="text-[11px] text-slate-700">
                    "We offer <strong>SHP-RSC-6045 (PKG-HYD-011)</strong> at{' '}
                    <span className="bg-slate-100 px-1 font-mono">₹68.40/Box</span> and the Full Overlap Casting Carton <strong>SHP-FOL-5040 (PKG-HYD-012)</strong> at{' '}
                    <span
                      onClick={() => setInspectedItemId('PKG-HYD-012')}
                      className="bg-rose-50 border border-rose-300 px-1 font-mono font-semibold text-rose-800 cursor-pointer"
                    >
                      ₹74.76/Box Ex-Works
                    </span>
                    ..."
                  </p>
                  <div className="border-b border-slate-200 pb-1.5 font-semibold text-slate-800">
                    Schedule B Table (Page 5) & Section 3.4 Exclusions (27/30 Quoted)
                  </div>
                  <p className="text-[11px] text-slate-700">
                    "Schedule B Line 12: <strong>PKG-HYD-012</strong> ={' '}
                    <span
                      onClick={() => setInspectedItemId('PKG-HYD-012')}
                      className="bg-rose-50 border border-rose-300 px-1 font-mono font-semibold text-rose-800 cursor-pointer"
                    >
                      ₹79.50/Box Ex-Works
                    </span>{' '}
                    (Conflict). Add <strong>+3.5% freight</strong> to Pashamylaram. <strong>No Quote (3 items):</strong> PKG-HYD-027, PKG-HYD-028, and PKG-HYD-030."
                  </p>
                </div>
              )}

              {activeVendor.id === 'V-SOUTHERN' && (
                <div className="p-3.5 bg-stone-100 text-slate-900 rounded border border-amber-400 space-y-2">
                  <div className="flex justify-between items-start border-b border-stone-300 pb-1.5">
                    <div>
                      <div className="font-bold text-xs">SOUTHERN BOX MANUFACTURING</div>
                      <div className="text-[10px] text-stone-500">Camera Photo · Skew 14°</div>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold text-rose-800 border border-rose-400 rounded">
                      INCL. 18% GST · +4% FREIGHT
                    </span>
                  </div>
                  <div className="space-y-1.5 text-[11px] font-mono">
                    <div
                      onClick={() => setInspectedItemId('PKG-HYD-001')}
                      className="p-1.5 bg-white rounded flex justify-between cursor-pointer"
                    >
                      <span>PKG-HYD-001</span>
                      <span>₹92.75 [OCR 84%]</span>
                    </div>
                    <div
                      onClick={() => setInspectedItemId('PKG-HYD-004')}
                      className="p-1.5 bg-amber-50 border border-amber-300 rounded flex justify-between cursor-pointer"
                    >
                      <span>PKG-HYD-004</span>
                      <span className="text-amber-900 font-semibold">
                        <s>52.00</s> ₹49.84 [Handwritten · 61.5%]
                      </span>
                    </div>
                    <div
                      onClick={() => setInspectedItemId('PKG-HYD-015')}
                      className="p-1.5 bg-amber-50 border border-amber-300 rounded flex justify-between cursor-pointer"
                    >
                      <span>PKG-HYD-015</span>
                      <span className="text-amber-900 font-semibold">
                        <s>18.00</s> ₹16.52 [Blur · 61.5%]
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {activeVendor.id === 'V-ECOWRAP' && (
                <div className="p-3.5 bg-white text-slate-900 rounded border border-slate-300 space-y-2.5 font-sans text-[11px]">
                  <div className="bg-slate-50 p-2 rounded font-mono text-[10px] text-slate-600">
                    <div>From: Meera Krishnan &lt;meera@ecowrappack.com&gt;</div>
                    <div>Subject: RE: RFQ-AER-HYD-2026-089 Quotation</div>
                  </div>
                  <div
                    onClick={() => setInspectedItemId('PKG-HYD-009')}
                    className="p-2 bg-rose-50 border border-rose-200 rounded text-rose-900 font-mono text-[10px] cursor-pointer"
                  >
                    <strong>Line 14 [Historical Reference]:</strong> "For Items 009, 010 & 018, please apply the same unit rate as our Q3 2025 PO #PO-HYD-25-114."
                  </div>
                  <div
                    onClick={() => setInspectedItemId('PKG-HYD-019')}
                    className="p-2 bg-amber-50 border border-amber-200 rounded text-amber-900 font-mono text-[10px] cursor-pointer"
                  >
                    <strong>Line 19 [Unknown Unit]:</strong> "Item 019 (5-Ply Layer Pad): ₹8,500 per strapped Pallet Load DDP."
                  </div>
                  <div
                    onClick={() => setInspectedItemId('PKG-HYD-022')}
                    className="p-2 bg-slate-50 border border-slate-200 rounded text-slate-600 font-mono text-[10px] cursor-pointer"
                  >
                    <strong>Line 31 [Missing]:</strong> "Custom die-cut cartons (8 items) not quoted."
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANEL: Extracted Structured Information */}
          <div className="lg:col-span-7 bg-white border border-slate-200/90 rounded-lg flex flex-col h-[660px] overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200/80 bg-slate-50/50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md">
                {(
                  [
                    { id: 'ALL', label: 'All (30)' },
                    { id: 'verified', label: 'Verified' },
                    { id: 'low_confidence', label: 'Low Confidence' },
                    { id: 'missing', label: 'Missing' },
                    { id: 'unresolved', label: 'Unresolved / Assumptions' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFieldFilter(f.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                      fieldFilter === f.id
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-slate-400">
                Hover row to trace source · Click to verify/edit
              </span>
            </div>

            {!isVendorExtracted ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-3">
                <div className="text-sm font-semibold text-slate-900">
                  {activeVendor.name} is awaiting extraction
                </div>
                <p className="text-xs text-slate-500 max-w-sm">
                  Trigger extraction on {activeVendor.documentFileName} to review structured line-item prices, cell/page references, and exceptions.
                </p>
                <button
                  onClick={() => onExtractVendor(activeVendor.id)}
                  className="px-4 py-2 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3 h-3 fill-white" />
                  <span>Extract {activeVendor.shortName}</span>
                </button>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200/80 z-10 text-[11px] font-medium text-slate-500">
                    <tr>
                      <th className="py-2.5 px-3">Item</th>
                      <th className="py-2.5 px-3">Extracted Value</th>
                      <th className="py-2.5 px-3 text-right">Normalised (INR)</th>
                      <th className="py-2.5 px-3">Source Citation</th>
                      <th className="py-2.5 px-3 text-right">Conf.</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/70 text-xs">
                    {vendorCells.map((cell) => {
                      const item = lineItems.find((i) => i.id === cell.itemId);
                      const isInspected = cell.itemId === inspectedCell?.itemId;
                      return (
                        <tr
                          key={cell.itemId}
                          onMouseEnter={() => setInspectedItemId(cell.itemId)}
                          onClick={() => {
                            setInspectedItemId(cell.itemId);
                            onOpenCellEvidence(cell.itemId, activeVendor.id);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isInspected
                              ? 'bg-[#6161F5]/[0.06]'
                              : 'hover:bg-slate-50/90'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-mono font-medium text-slate-900 whitespace-nowrap">
                            <div>{cell.itemId}</div>
                            <div className="text-[10px] font-sans font-normal text-slate-400 truncate max-w-[135px]">
                              {item?.description}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                            {!cell.quoted ? (
                              <span className="text-slate-400">Not Quoted</span>
                            ) : cell.rawQuotedPrice !== null ? (
                              <span>
                                {cell.rawCurrency === 'USD' ? '$' : '₹'}
                                {cell.rawQuotedPrice.toLocaleString('en-IN', {
                                  minimumFractionDigits: 2,
                                })}{' '}
                                <span className="text-[10px] text-slate-400">/{cell.rawUom}</span>
                              </span>
                            ) : (
                              <span className="text-rose-700 font-medium">2025 Q3 Ref</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-medium whitespace-nowrap">
                            {cell.normalisedUnitPriceInr !== null ? (
                              <span className="text-slate-900">
                                ₹{cell.normalisedUnitPriceInr.toFixed(2)}
                              </span>
                            ) : cell.quoted ? (
                              <span className="text-rose-700 text-[11px]">
                                Blocked (₹{cell.provisionalUnitPriceInr?.toFixed(2)})
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td
                            className="py-2.5 px-3 font-mono text-[11px] text-slate-500 max-w-[165px] truncate"
                            title={cell.sourceReference}
                          >
                            {cell.sourceReference}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            <span
                              className={
                                cell.confidencePct < 75
                                  ? 'text-amber-700 font-semibold'
                                  : 'text-slate-600'
                              }
                            >
                              {cell.confidencePct}%
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            {!cell.quoted ? (
                              <TrustBadge type="missing_info" />
                            ) : cell.buyerVerified ? (
                              <TrustBadge type="buyer_verified" />
                            ) : !cell.isComparable ? (
                              <TrustBadge type="not_comparable" labelOverride="Blocked" />
                            ) : cell.validationStatus === 'low_confidence' ? (
                              <TrustBadge type="low_confidence" />
                            ) : cell.validationStatus === 'footnote_discount_applied' ? (
                              <TrustBadge type="ai_generated" labelOverride="Footnote -4.5%" />
                            ) : (
                              <TrustBadge type="source_verified" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 2: EXCEPTION QUEUE */}
      {activeSubView === 'exception-queue' && (
        <div className="bg-white border border-slate-200/90 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                Extraction & Governance Exception Queue
              </h3>
              <p className="text-[11px] text-slate-500">
                Resolve conflicting prices, historical references, unknown units, and low-confidence OCR readings
              </p>
            </div>
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 rounded-md">
              {(['ALL', 'Critical', 'Warning', 'Info'] as const).map((sev) => (
                <button
                  key={sev}
                  onClick={() => setSeverityFilter(sev)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                    severityFilter === sev
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {sev}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-200/70">
            {filteredExceptions.map((exc) => {
              const vendor = vendors.find((v) => v.id === exc.vendorId);
              const isResolved = exc.status === 'Resolved (Buyer Verified)';
              return (
                <div
                  key={exc.id}
                  className={`p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                    isResolved ? 'bg-slate-50/50 opacity-80' : 'bg-white'
                  }`}
                >
                  <div className="space-y-1 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                          exc.severity === 'Critical'
                            ? 'bg-rose-50 text-rose-800 border-rose-200'
                            : exc.severity === 'Warning'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {exc.severity}
                      </span>
                      <span className="text-xs font-mono font-medium text-slate-700">
                        {exc.id} · {vendor?.shortName} · {exc.itemId}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        Confidence {exc.confidencePct}%
                      </span>
                      {isResolved ? (
                        <TrustBadge type="buyer_verified" labelOverride="Resolved" />
                      ) : (
                        <TrustBadge type="requires_clarification" labelOverride={exc.status} />
                      )}
                    </div>
                    <div className="text-xs font-semibold text-slate-900">{exc.title}</div>
                    <p className="text-xs text-slate-500">{exc.description}</p>
                    <div className="text-[11px] font-mono text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200/80">
                      [{exc.sourceReference}] {exc.sourceSnippet}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => onOpenCellEvidence(exc.itemId, exc.vendorId)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md cursor-pointer"
                    >
                      Inspect Source
                    </button>
                    {!isResolved && (
                      <button
                        onClick={() => onResolveException(exc.id, exc.resolvedValueInr)}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>
                          {exc.resolvedValueInr
                            ? `Verify (₹${exc.resolvedValueInr.toFixed(2)})`
                            : 'Resolve'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* VIEW 3: STANDARDISATION ENGINE */}
      {activeSubView === 'standardisation-engine' && (
        <div className="bg-white border border-slate-200/90 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                Unit, Currency & Commercial Normalisation Engine
              </h3>
              <p className="text-[11px] text-slate-500">
                Explicit conversion formulas and assumptions applied before cross-vendor comparison
              </p>
            </div>
            <TrustBadge
              type={unverifiedRulesCount === 0 ? 'buyer_verified' : 'requires_clarification'}
              labelOverride={`${conversionRules.length - unverifiedRulesCount}/${conversionRules.length} Verified`}
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-3">Rule & Category</th>
                  <th className="py-2.5 px-3">Vendor</th>
                  <th className="py-2.5 px-3">Original Value</th>
                  <th className="py-2.5 px-3">Conversion Formula</th>
                  <th className="py-2.5 px-3">Standardised Value</th>
                  <th className="py-2.5 px-3">Assumption</th>
                  <th className="py-2.5 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {conversionRules.map((rule) => {
                  const vendor = vendors.find((v) => v.id === rule.vendorId);
                  return (
                    <tr key={rule.id} className="hover:bg-slate-50/80">
                      <td className="py-3 px-3">
                        <div className="font-mono font-semibold text-slate-900">{rule.id}</div>
                        <div className="text-[11px] text-[#6161F5]">{rule.category}</div>
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900">
                        {vendor?.shortName}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-700">
                        {rule.originalValueDisplay}
                      </td>
                      <td className="py-3 px-3 font-mono text-[11px] text-slate-800">
                        {rule.conversionFormula}
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-emerald-700">
                        {rule.standardisedValueDisplay}
                      </td>
                      <td className="py-3 px-3 text-[11px] text-slate-500 max-w-xs">
                        {rule.assumptionText}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        {rule.verificationStatus === 'Buyer Verified' ? (
                          <TrustBadge type="buyer_verified" />
                        ) : (
                          <button
                            onClick={() => onVerifyConversionRule(rule.id)}
                            className="px-2.5 py-1 text-[11px] font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>Approve Rule</span>
                          </button>
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
    </div>
  );
};
