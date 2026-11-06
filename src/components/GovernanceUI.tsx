import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Sparkles,
  FileSearch,
  HelpCircle,
  Ban,
  X,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Mail,
  ArrowRight,
  Check,
} from 'lucide-react';
import {
  ValidationBadgeType,
  LineItem,
  Vendor,
  VendorQuoteCell,
  ConversionRule,
} from '../types/procurement';
import { formatInr } from '../services/procurementEngine';

export const TrustBadge: React.FC<{
  type: ValidationBadgeType;
  labelOverride?: string;
}> = ({ type, labelOverride }) => {
  const styles: Record<
    ValidationBadgeType,
    { text: string; bg: string; border: string; icon: React.ReactNode; defaultLabel: string }
  > = {
    ai_generated: {
      text: 'text-[#6161F5]',
      bg: 'bg-[#6161F5]/[0.06]',
      border: 'border-[#6161F5]/20',
      icon: <Sparkles className="w-3 h-3 text-[#6161F5] shrink-0" />,
      defaultLabel: 'AI-Assisted',
    },
    source_verified: {
      text: 'text-slate-700',
      bg: 'bg-slate-100/80',
      border: 'border-slate-200',
      icon: <FileSearch className="w-3 h-3 text-slate-500 shrink-0" />,
      defaultLabel: 'Source Verified',
    },
    buyer_verified: {
      text: 'text-emerald-700',
      bg: 'bg-emerald-50/80',
      border: 'border-emerald-200/80',
      icon: <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />,
      defaultLabel: 'Verified',
    },
    low_confidence: {
      text: 'text-amber-700',
      bg: 'bg-amber-50/80',
      border: 'border-amber-200/80',
      icon: <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />,
      defaultLabel: 'Low Confidence',
    },
    missing_info: {
      text: 'text-slate-500',
      bg: 'bg-slate-100/70',
      border: 'border-slate-200/80',
      icon: <Ban className="w-3 h-3 text-slate-400 shrink-0" />,
      defaultLabel: 'Missing Quote',
    },
    requires_clarification: {
      text: 'text-amber-800',
      bg: 'bg-amber-50/90',
      border: 'border-amber-200',
      icon: <HelpCircle className="w-3 h-3 text-amber-600 shrink-0" />,
      defaultLabel: 'Needs Review',
    },
    not_comparable: {
      text: 'text-rose-700',
      bg: 'bg-rose-50/80',
      border: 'border-rose-200',
      icon: <Ban className="w-3 h-3 text-rose-600 shrink-0" />,
      defaultLabel: 'Not Comparable',
    },
    quality_disqualified: {
      text: 'text-rose-800',
      bg: 'bg-rose-50/90',
      border: 'border-rose-200',
      icon: <ShieldAlert className="w-3 h-3 text-rose-600 shrink-0" />,
      defaultLabel: 'Disqualified (QA)',
    },
  };

  const cfg = styles[type];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border rounded-md ${cfg.bg} ${cfg.text} ${cfg.border} whitespace-nowrap shrink-0`}
    >
      {cfg.icon}
      <span>{labelOverride || cfg.defaultLabel}</span>
    </span>
  );
};

export const DocumentFormatIcon: React.FC<{
  format: Vendor['documentFormat'];
  className?: string;
}> = ({ format, className = 'w-4 h-4' }) => {
  if (format.includes('Excel'))
    return <FileSpreadsheet className={`${className} text-emerald-600 shrink-0`} />;
  if (format.includes('PDF'))
    return <FileText className={`${className} text-rose-600 shrink-0`} />;
  if (format.includes('Word'))
    return <FileText className={`${className} text-blue-600 shrink-0`} />;
  if (format.includes('Image'))
    return <ImageIcon className={`${className} text-amber-600 shrink-0`} />;
  return <Mail className={`${className} text-[#6161F5] shrink-0`} />;
};

export const SourceEvidenceDrawer: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  item: LineItem | null;
  vendor: Vendor | null;
  cell: VendorQuoteCell | null;
  conversionRule?: ConversionRule;
  isVendorQualityQualified: boolean;
  onVerifyCell: (itemId: string, vendorId: string, newPriceInr?: number) => void;
  onRequestClarification: (vendorId: string, itemId: string, note: string) => void;
}> = ({
  isOpen,
  onClose,
  item,
  vendor,
  cell,
  conversionRule,
  isVendorQualityQualified,
  onVerifyCell,
  onRequestClarification,
}) => {
  const [overrideInput, setOverrideInput] = React.useState<string>('');
  const [clarificationText, setClarificationText] = React.useState<string>('');

  React.useEffect(() => {
    if (cell) {
      setOverrideInput(
        (cell.normalisedUnitPriceInr ?? cell.provisionalUnitPriceInr ?? '').toString()
      );
      setClarificationText(
        `Please confirm binding 2026 unit rate and UOM for ${item?.id} (${item?.description}).`
      );
    }
  }, [cell, item]);

  if (!isOpen || !item || !vendor || !cell) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-[1px] transition-opacity">
      <div className="w-full max-w-lg bg-white h-full border-l border-slate-200 flex flex-col justify-between overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono">
              <span>{item.id}</span>
              <span>/</span>
              <span>{vendor.shortName}</span>
              <span>/</span>
              <span>{vendor.documentFormat}</span>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mt-0.5">
              Source Evidence & Normalisation Audit
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
            aria-label="Close evidence drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Status Row */}
          <div className="flex flex-wrap items-center gap-2">
            {cell.buyerVerified ? (
              <TrustBadge type="buyer_verified" labelOverride="Buyer Verified" />
            ) : (
              <TrustBadge type="ai_generated" labelOverride="AI Extracted" />
            )}
            <TrustBadge
              type="source_verified"
              labelOverride={`Confidence ${cell.confidencePct}%`}
            />
            {!isVendorQualityQualified && <TrustBadge type="quality_disqualified" />}
            {!cell.isComparable && !cell.buyerVerified && (
              <TrustBadge type="not_comparable" />
            )}
            {cell.validationStatus === 'low_confidence' && !cell.buyerVerified && (
              <TrustBadge type="low_confidence" />
            )}
          </div>

          {/* Line Item Specification */}
          <div className="border-y border-slate-200 py-3.5 space-y-2">
            <div className="flex justify-between items-start gap-4">
              <div>
                <div className="text-[11px] font-medium text-slate-400">Line Item</div>
                <div className="text-xs font-semibold text-slate-900 mt-0.5">
                  {item.description}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">{item.gsmAndFlute}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-medium text-slate-400">Quantity</div>
                <div className="text-xs font-mono font-semibold text-slate-900 mt-0.5">
                  {item.quantity.toLocaleString('en-IN')} {item.standardUom}
                </div>
              </div>
            </div>
            <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Supplier: <strong className="text-slate-800 font-medium">{vendor.name}</strong>
              </span>
              <span>
                Baseline:{' '}
                <strong className="font-mono text-slate-800">
                  ₹{item.baselineUnitPriceInr.toFixed(2)}/{item.standardUom}
                </strong>
              </span>
            </div>
          </div>

          {/* Document Snippet */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">
                Original Document Citation
              </span>
              <span className="text-[11px] font-mono text-[#6161F5] bg-[#6161F5]/[0.06] px-2 py-0.5 rounded border border-[#6161F5]/20">
                {cell.sourceReference}
              </span>
            </div>
            <div className="p-3.5 bg-[#18181B] text-slate-200 rounded-lg font-mono text-xs leading-relaxed">
              <div className="text-slate-400 text-[10px] mb-1.5 flex items-center justify-between border-b border-slate-800 pb-1">
                <span>{vendor.documentFileName}</span>
                <span>OCR/PARSE: {cell.confidencePct}%</span>
              </div>
              <p className="text-slate-100">{cell.sourceSnippet}</p>
            </div>
            {cell.exceptionNote && (
              <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-lg text-xs text-amber-900">
                <span className="font-semibold">Exception Note:</span> {cell.exceptionNote}
              </div>
            )}
          </div>

          {/* Standardisation Math */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-800 block">
              Normalisation Calculation
            </span>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-200/80 text-xs">
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Raw Quoted Input</span>
                <span className="font-mono font-medium text-slate-900">
                  {cell.rawQuotedPrice !== null
                    ? `${cell.rawCurrency === 'USD' ? '$' : '₹'}${cell.rawQuotedPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })} / ${cell.rawUom}`
                    : cell.quoted
                    ? 'Historical Reference (Unverified)'
                    : 'Not Quoted'}
                </span>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-500">UOM / FX Factor</span>
                <span className="font-mono text-slate-700">
                  {cell.rawCurrency === 'USD'
                    ? '× ₹83.50 (USD → INR)'
                    : cell.conversionFactorToStandard !== 1
                    ? `× ${cell.conversionFactorToStandard} (${cell.rawUom} → ${item.standardUom})`
                    : `1.00 (${item.standardUom})`}
                </span>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Commercial Adjustments</span>
                <span className="font-mono text-slate-700">
                  {cell.discountAppliedPct > 0 ? `-${cell.discountAppliedPct}% Footnote ` : ''}
                  {cell.freightAdjustmentPct > 0 ? `+${cell.freightAdjustmentPct}% Freight ` : ''}
                  {cell.gstNormalisationAdjustmentPct !== 0 ? `Excl. 18% GST ` : ''}
                  {cell.discountAppliedPct === 0 &&
                  cell.freightAdjustmentPct === 0 &&
                  cell.gstNormalisationAdjustmentPct === 0
                    ? 'None (DDP Net 45)'
                    : ''}
                </span>
              </div>
              <div className="px-3.5 py-2.5 bg-slate-50/80 flex items-center justify-between">
                <span className="font-medium text-slate-900">
                  Standardised Unit Price (INR / {item.standardUom})
                </span>
                <span className="font-mono text-sm font-semibold text-[#6161F5]">
                  {cell.normalisedUnitPriceInr !== null
                    ? `₹${cell.normalisedUnitPriceInr.toFixed(2)}`
                    : cell.provisionalUnitPriceInr !== null
                    ? `₹${cell.provisionalUnitPriceInr.toFixed(2)} (Blocked)`
                    : '—'}
                </span>
              </div>
              {cell.normalisedUnitPriceInr !== null && (
                <div className="px-3.5 py-2.5 flex items-center justify-between text-slate-500">
                  <span>Extended Line Total</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {formatInr(cell.normalisedUnitPriceInr * item.quantity)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {conversionRule && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
              <div className="font-medium text-slate-900 flex items-center justify-between">
                <span>Rule {conversionRule.id} ({conversionRule.category})</span>
                <span className="text-[11px] text-slate-500">{conversionRule.verificationStatus}</span>
              </div>
              <div className="text-slate-700 font-mono text-[11px]">
                {conversionRule.conversionFormula}
              </div>
              <div className="text-slate-500 text-[11px]">{conversionRule.assumptionText}</div>
            </div>
          )}

          {/* Buyer Verification Action */}
          {cell.quoted && (
            <div className="p-4 border border-slate-200 rounded-lg space-y-3">
              <div className="text-xs font-semibold text-slate-900">
                Buyer Verification & Override
              </div>
              <div className="flex items-end gap-2.5">
                <div className="flex-1">
                  <label className="block text-[11px] text-slate-500 mb-1">
                    Approved Unit Rate (INR / {item.standardUom})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={overrideInput}
                    onChange={(e) => setOverrideInput(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-md focus:outline-none focus:border-[#6161F5]"
                  />
                </div>
                <button
                  onClick={() => {
                    const parsed = parseFloat(overrideInput);
                    onVerifyCell(
                      item.id,
                      vendor.id,
                      !isNaN(parsed) && parsed > 0 ? parsed : undefined
                    );
                  }}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{cell.buyerVerified ? 'Update Rate' : 'Verify & Unblock'}</span>
                </button>
              </div>
              {cell.conflictSecondaryValueInr && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] text-slate-500">Select Value:</span>
                  <button
                    onClick={() => {
                      setOverrideInput(String(cell.provisionalUnitPriceInr ?? 77.38));
                      onVerifyCell(item.id, vendor.id, cell.provisionalUnitPriceInr ?? 77.38);
                    }}
                    className="px-2 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 rounded cursor-pointer"
                  >
                    Para 4 (₹{cell.provisionalUnitPriceInr?.toFixed(2)})
                  </button>
                  <button
                    onClick={() => {
                      setOverrideInput(String(cell.conflictSecondaryValueInr));
                      onVerifyCell(item.id, vendor.id, cell.conflictSecondaryValueInr);
                    }}
                    className="px-2 py-1 text-[11px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-800 rounded cursor-pointer"
                  >
                    Schedule B (₹{cell.conflictSecondaryValueInr.toFixed(2)})
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Request Clarification */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-800">
              Request Supplier Clarification
            </label>
            <textarea
              rows={2}
              value={clarificationText}
              onChange={(e) => setClarificationText(e.target.value)}
              className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-md focus:bg-white focus:outline-none focus:border-[#6161F5]"
            />
            <button
              onClick={() => onRequestClarification(vendor.id, item.id, clarificationText)}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-md inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Send Clarification</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between">
          <span className="text-[11px] font-mono text-slate-400">
            REF: {item.id} · {vendor.id}
          </span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
