import React, { useState } from 'react';
import {
  FileSpreadsheet,
  FileJson,
  Eye,
  Printer,
  Download,
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
import { PROJECT_METADATA } from '../data/seedData';
import { TrustBadge } from './GovernanceUI';

interface ReportsExportsViewProps {
  lineItems: LineItem[];
  vendors: Vendor[];
  quoteCells: VendorQuoteCell[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  exceptions: ExtractionException[];
  scenarioConfig: ScenarioConfig;
  onNotify: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

type ReportId =
  | 'vendor-comparison'
  | 'rfq-summary'
  | 'questionnaire-report'
  | 'exception-report'
  | 'award-recommendation'
  | 'savings-report';

export const ReportsExportsView: React.FC<ReportsExportsViewProps> = ({
  lineItems,
  vendors,
  quoteCells,
  questions,
  responses,
  exceptions,
  scenarioConfig,
  onNotify,
}) => {
  const [selectedReport, setSelectedReport] = useState<ReportId>('vendor-comparison');

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

  const triggerDownload = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob(['\uFEFF' + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onNotify(`Downloaded ${filename}`, 'success');
  };

  const buildReportPayload = (reportId: ReportId): {
    title: string;
    subtitle: string;
    headers: string[];
    rows: (string | number)[][];
    csvName: string;
    jsonName: string;
  } => {
    if (reportId === 'vendor-comparison') {
      const headers = [
        'Item ID',
        'SKU Code',
        'Product Description',
        'Category',
        'Qty',
        'UOM',
        'Baseline Rate (INR)',
        'Apex Packaging (INR)',
        'Global Corrugators (INR)',
        'PrimePack Solutions (INR)',
        'Southern Box Mfg [Disq] (INR)',
        'EcoWrap Packaging (INR)',
        'Lowest Eligible Price (INR)',
        'Recommended Vendor',
      ];
      const rows = lineItems.map((item) => {
        const alloc = scenarioResult.itemAllocations.find((a) => a.itemId === item.id);
        const recVendor = vendors.find((v) => v.id === alloc?.awardedVendorId);
        const getVal = (vId: string) => {
          const c = quoteCells.find((cell) => cell.itemId === item.id && cell.vendorId === vId);
          if (!c || !c.quoted) return 'No Quote';
          if (c.normalisedUnitPriceInr === null) return `Blocked (${c.provisionalUnitPriceInr ?? ''})`;
          return c.normalisedUnitPriceInr.toFixed(2);
        };
        return [
          item.id,
          item.code,
          item.description,
          item.category,
          item.quantity,
          item.standardUom,
          item.baselineUnitPriceInr.toFixed(2),
          getVal('V-APEX'),
          getVal('V-GLOBAL'),
          getVal('V-PRIMEPACK'),
          getVal('V-SOUTHERN'),
          getVal('V-ECOWRAP'),
          alloc?.unitPriceInr ? alloc.unitPriceInr.toFixed(2) : 'N/A',
          recVendor?.shortName || 'Unallocated',
        ];
      });
      return {
        title: '1. Side-by-Side Vendor Bid Comparison Report (30 Line Items × 5 Vendors)',
        subtitle: 'Normalised DDP Pashamylaram unit rates (INR Excl. 18% GST) with lowest eligible bidder attribution.',
        headers,
        rows,
        csvName: 'ProcureIQ_Vendor_Bid_Comparison_2026.csv',
        jsonName: 'ProcureIQ_Vendor_Bid_Comparison_2026.json',
      };
    }

    if (reportId === 'rfq-summary') {
      const headers = [
        'Item ID',
        'SKU Code',
        'Category',
        'Description',
        'GSM & Flute Spec',
        'Bursting Strength',
        'Dimensions (mm)',
        'Quantity',
        'UOM',
        'Target Delivery (Days)',
        'Approval Status',
      ];
      const rows = lineItems.map((i) => [
        i.id,
        i.code,
        i.category,
        i.description,
        i.gsmAndFlute,
        i.burstingStrengthCS,
        i.dimensionsMm,
        i.quantity,
        i.standardUom,
        i.targetDeliveryDays,
        i.approvalStatus === 'buyer_approved' ? 'Buyer Approved' : 'AI Draft',
      ]);
      return {
        title: '2. RFx Scope & Technical Specifications Summary Report',
        subtitle: `${PROJECT_METADATA.rfqReference} — ${PROJECT_METADATA.name} (${lineItems.length} Line Items)`,
        headers,
        rows,
        csvName: 'ProcureIQ_RFQ_Technical_Summary_2026.csv',
        jsonName: 'ProcureIQ_RFQ_Technical_Summary_2026.json',
      };
    }

    if (reportId === 'questionnaire-report') {
      const headers = [
        'Question ID',
        'Category',
        'Criterion',
        'Gate Type',
        'Weight %',
        'Apex Packaging',
        'Global Corrugators',
        'PrimePack Solutions',
        'Southern Box Mfg.',
        'EcoWrap Packaging',
      ];
      const rows = questions.map((q) => {
        const getScore = (vId: string) => {
          const r = responses.find((resp) => resp.questionId === q.id && resp.vendorId === vId);
          if (!r) return 'N/A';
          return `${r.scoreOutOf100}/100 (${r.passedMandatoryCheck ? 'PASS' : 'FAIL'})`;
        };
        return [
          q.id,
          q.category,
          q.questionText,
          q.mandatoryCriterion ? 'MANDATORY HARD GATE' : 'Weighted Soft Score',
          q.weightPct,
          getScore('V-APEX'),
          getScore('V-GLOBAL'),
          getScore('V-PRIMEPACK'),
          getScore('V-SOUTHERN'),
          getScore('V-ECOWRAP'),
        ];
      });
      return {
        title: '3. Vendor Qualification & Mandatory QA Gate Evaluation Report',
        subtitle: '12-point assessment across ISO 9001:2015, in-house Bursting/BCT labs, capacity, defect PPM, and ESG compliance.',
        headers,
        rows,
        csvName: 'ProcureIQ_Vendor_Questionnaire_Report_2026.csv',
        jsonName: 'ProcureIQ_Vendor_Questionnaire_Report_2026.json',
      };
    }

    if (reportId === 'exception-report') {
      const headers = [
        'Exception ID',
        'Severity',
        'Vendor',
        'Item ID',
        'Type',
        'Title',
        'Extracted Input',
        'Source Reference',
        'Confidence %',
        'Governance Status',
      ];
      const rows = exceptions.map((e) => {
        const v = vendors.find((vend) => vend.id === e.vendorId);
        return [
          e.id,
          e.severity,
          v?.name || e.vendorId,
          e.itemId,
          e.type,
          e.title,
          e.extractedValueDisplay,
          e.sourceReference,
          `${e.confidencePct}%`,
          e.status,
        ];
      });
      return {
        title: '4. Document Extraction & Normalisation Exception Audit Report',
        subtitle: 'Full audit trail of OCR warnings, conflicting Word values, footnote discounts, unknown UOMs, and 2025 rate references.',
        headers,
        rows,
        csvName: 'ProcureIQ_Exception_Audit_Report_2026.csv',
        jsonName: 'ProcureIQ_Exception_Audit_Report_2026.json',
      };
    }

    if (reportId === 'award-recommendation') {
      const headers = [
        'Item ID',
        'Product Description',
        'Quantity',
        'UOM',
        'Awarded Vendor',
        'Awarded Unit Rate (INR)',
        'Total Award Value (INR)',
        'Baseline Cost (INR)',
        'Verified Savings (INR)',
        'Allocation Rationale',
      ];
      const rows = scenarioResult.itemAllocations.map((a) => {
        const item = lineItems.find((i) => i.id === a.itemId)!;
        const v = vendors.find((vend) => vend.id === a.awardedVendorId);
        return [
          a.itemId,
          item.description,
          item.quantity,
          item.standardUom,
          v?.name || 'Unallocated',
          a.unitPriceInr ? a.unitPriceInr.toFixed(2) : 'N/A',
          a.totalLineCostInr.toFixed(2),
          a.baselineLineCostInr.toFixed(2),
          a.savingsInr.toFixed(2),
          a.allocationReason,
        ];
      });
      return {
        title: '5. Executive Award Recommendation Schedule (30 Line Items)',
        subtitle: `Strategy: ${scenarioConfig.name} · Total Award: ${formatInr(scenarioResult.totalProcurementCostInr)} · Savings: ${formatInr(scenarioResult.totalSavingsInr)} (${scenarioResult.savingsPct}%)`,
        headers,
        rows,
        csvName: 'ProcureIQ_VP_Award_Recommendation_2026.csv',
        jsonName: 'ProcureIQ_VP_Award_Recommendation_2026.json',
      };
    }

    const headers = [
      'Packaging Category',
      'SKUs Count',
      'Total Units',
      '2026 Baseline Spend (INR)',
      'Recommended Award Spend (INR)',
      'Net Savings (INR)',
      'Savings %',
    ];
    const categories = Array.from(new Set(lineItems.map((i) => i.category)));
    const rows = categories.map((cat) => {
      const catItems = lineItems.filter((i) => i.category === cat);
      const catAllocs = scenarioResult.itemAllocations.filter((a) =>
        catItems.some((i) => i.id === a.itemId)
      );
      const baseSpend = catAllocs.reduce((s, a) => s + a.baselineLineCostInr, 0);
      const awardSpend = catAllocs.reduce((s, a) => s + a.totalLineCostInr, 0);
      const sav = baseSpend - awardSpend;
      const pct = baseSpend > 0 ? ((sav / baseSpend) * 100).toFixed(2) : '0.00';
      return [
        cat,
        catItems.length,
        catItems.reduce((s, i) => s + i.quantity, 0).toLocaleString('en-IN'),
        formatInr(baseSpend),
        formatInr(awardSpend),
        formatInr(sav),
        `${pct}%`,
      ];
    });
    return {
      title: '6. Category-Level Procurement Savings & Value Realisation Report',
      subtitle: `Total Baseline: ${formatLakhs(scenarioResult.totalBaselineCostInr)} vs Optimal Award: ${formatLakhs(scenarioResult.totalProcurementCostInr)} (Net Savings: ${formatLakhs(scenarioResult.totalSavingsInr)})`,
      headers,
      rows,
      csvName: 'ProcureIQ_Savings_Realisation_Report_2026.csv',
      jsonName: 'ProcureIQ_Savings_Realisation_Report_2026.json',
    };
  };

  const activePayload = buildReportPayload(selectedReport);

  const handleDownloadCsv = (reportId: ReportId) => {
    const payload = buildReportPayload(reportId);
    const csvLines = [
      payload.headers.map((h) => `"${String(h).replace(/"/g, '""')}"`).join(','),
      ...payload.rows.map((r) =>
        r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
      ),
    ];
    triggerDownload(payload.csvName, csvLines.join('\n'), 'text/csv;charset=utf-8;');
  };

  const handleDownloadJson = (reportId: ReportId) => {
    const payload = buildReportPayload(reportId);
    const jsonObj = {
      project: PROJECT_METADATA,
      reportTitle: payload.title,
      generatedAt: new Date().toISOString(),
      columns: payload.headers,
      records: payload.rows.map((r) => {
        const obj: Record<string, string | number> = {};
        payload.headers.forEach((h, idx) => {
          obj[h] = r[idx];
        });
        return obj;
      }),
    };
    triggerDownload(
      payload.jsonName,
      JSON.stringify(jsonObj, null, 2),
      'application/json;charset=utf-8;'
    );
  };

  const reportCards: { id: ReportId; name: string; desc: string; countLabel: string }[] = [
    {
      id: 'vendor-comparison',
      name: 'Vendor Comparison Report',
      desc: 'Side-by-side 30×5 normalised INR pricing matrix with lowest eligible bidder attribution.',
      countLabel: '30 Rows × 14 Cols',
    },
    {
      id: 'rfq-summary',
      name: 'RFQ Summary Report',
      desc: 'Complete technical specification schedule (GSM, Flute, Bursting Strength, Quantities).',
      countLabel: '30 Line Items',
    },
    {
      id: 'questionnaire-report',
      name: 'Vendor Questionnaire Report',
      desc: '12-point supplier qualification matrix with mandatory hard-gate pass/fail audit.',
      countLabel: '12 Criteria × 5 Vendors',
    },
    {
      id: 'exception-report',
      name: 'Exception & Governance Report',
      desc: 'Audit log of OCR warnings, historical 2025 references, conflicting values & UOM rules.',
      countLabel: `${exceptions.length} Exceptions`,
    },
    {
      id: 'award-recommendation',
      name: 'Award Recommendation Report',
      desc: 'Line-by-line supplier award schedule, extended line totals, and source evidence.',
      countLabel: formatLakhs(scenarioResult.totalProcurementCostInr),
    },
    {
      id: 'savings-report',
      name: 'Procurement Savings Report',
      desc: 'Category-by-category baseline vs awarded spend variance across 8 packaging families.',
      countLabel: `Saves ${formatLakhs(scenarioResult.totalSavingsInr)}`,
    },
  ];

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/90">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#18181B]">
            Reports & Audit Exports
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Generate and export audit-ready procurement dossiers in Excel (.CSV), structured .JSON, or printable executive formats
          </p>
        </div>
        <button
          onClick={() => handleDownloadCsv(selectedReport)}
          className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Active Report (.CSV)</span>
        </button>
      </div>

      {/* 6 Report Selector Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {reportCards.map((rc) => {
          const isSelected = rc.id === selectedReport;
          return (
            <div
              key={rc.id}
              onClick={() => setSelectedReport(rc.id)}
              className={`p-4 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                isSelected
                  ? 'bg-[#6161F5]/[0.04] border-[#6161F5] ring-1 ring-[#6161F5]'
                  : 'bg-white border-slate-200/90 hover:border-slate-300'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-[#18181B]">{rc.name}</h3>
                  <span className="text-[10px] font-mono text-[#6161F5] bg-[#6161F5]/[0.08] px-2 py-0.5 rounded border border-[#6161F5]/20 shrink-0">
                    {rc.countLabel}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{rc.desc}</p>
              </div>

              <div className="pt-3 mt-3 border-t border-slate-200/80 flex items-center justify-between gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedReport(rc.id);
                  }}
                  className="text-[11px] font-medium text-[#6161F5] hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  <span>Preview</span>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadCsv(rc.id);
                    }}
                    className="px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded inline-flex items-center gap-1 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3 h-3" />
                    <span>.CSV</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownloadJson(rc.id);
                    }}
                    className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded inline-flex items-center gap-1 cursor-pointer"
                  >
                    <FileJson className="w-3 h-3" />
                    <span>.JSON</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Live Interactive Report Preview Canvas */}
      <div className="bg-white rounded-lg border border-slate-200/90 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200/80 bg-[#FAFAFC] flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-[#18181B] uppercase tracking-wider">
                {activePayload.title}
              </h2>
              <TrustBadge type="source_verified" labelOverride="Live Dataset Preview" />
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">{activePayload.subtitle}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>Print / PDF</span>
            </button>
            <button
              onClick={() => handleDownloadCsv(selectedReport)}
              className="px-3 py-1.5 text-xs font-medium text-white bg-[#18181B] hover:bg-[#32323A] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {activePayload.csvName}</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[500px]">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-[#FAFAFC] border-b border-slate-200 text-[11px] font-medium text-slate-500">
              <tr>
                {activePayload.headers.map((h, i) => (
                  <th key={i} className="py-2.5 px-3 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70">
              {activePayload.rows.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/70">
                  {row.map((val, cIdx) => (
                    <td
                      key={cIdx}
                      className={`py-2 px-3 ${
                        typeof val === 'number' || String(val).startsWith('₹') || String(val).endsWith('%')
                          ? 'font-mono tabular-nums'
                          : ''
                      }`}
                    >
                      {val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
