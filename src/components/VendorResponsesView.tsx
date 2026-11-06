import React, { useState } from 'react';
import {
  Play,
  RefreshCw,
  Eye,
  FileSearch,
  CheckCircle2,
  XCircle,
  MessageSquare,
  Upload,
  X,
  ArrowUpRight,
} from 'lucide-react';
import {
  Vendor,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  WorkspaceId,
} from '../types/procurement';
import { calculateVendorQualification } from '../services/procurementEngine';
import { TrustBadge, DocumentFormatIcon } from './GovernanceUI';

interface VendorResponsesViewProps {
  vendors: Vendor[];
  questions: QuestionnaireQuestion[];
  responses: VendorQuestionnaireResponse[];
  onExtractVendor: (vendorId: string) => void;
  onExtractAllVendors: () => void;
  onApproveVendorExtraction: (vendorId: string) => void;
  onRejectVendor: (vendorId: string) => void;
  onRequestVendorClarification: (vendorId: string, note: string) => void;
  onUploadRevision: (vendorId: string, file: File) => void;
  onNavigate: (workspace: WorkspaceId, vendorIdHint?: string) => void;
}

export const VendorResponsesView: React.FC<VendorResponsesViewProps> = ({
  vendors,
  questions,
  responses,
  onExtractVendor,
  onExtractAllVendors,
  onApproveVendorExtraction,
  onRejectVendor,
  onRequestVendorClarification,
  onUploadRevision,
  onNavigate,
}) => {
  const [sidePreviewVendor, setSidePreviewVendor] = useState<Vendor | null>(null);
  const [clarifyingVendor, setClarifyingVendor] = useState<Vendor | null>(null);
  const [clarificationText, setClarificationText] = useState('');
  const [uploadingVendor, setUploadingVendor] = useState<Vendor | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const unextractedCount = vendors.filter((v) => v.processingStatus === 'unextracted').length;

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
              Vendor Response Inbox
            </h1>
            <TrustBadge
              type={unextractedCount > 0 ? 'requires_clarification' : 'buyer_verified'}
              labelOverride={
                unextractedCount > 0
                  ? `${unextractedCount} Awaiting Extraction`
                  : '5/5 Formats Processed'
              }
            />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Multi-format supplier submissions across Excel (.xlsx), PDF (.pdf), Word (.docx), Rate-Card Image (.jpg), and Email (.eml)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={() => {
              setUploadingVendor(vendors[0]);
              setUploadFile(null);
            }}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            <span>Upload Document</span>
          </button>

          <button
            onClick={onExtractAllVendors}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Play className="w-3 h-3 fill-white" />
            <span>
              {unextractedCount > 0
                ? `Extract All (${unextractedCount} Pending)`
                : 'Reprocess All 5 Formats'}
            </span>
          </button>
        </div>
      </div>

      {/* Main Content + Optional Side Preview Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Table / List Hybrid */}
        <div
          className={`${
            sidePreviewVendor ? 'lg:col-span-8' : 'lg:col-span-12'
          } bg-white border border-slate-200/90 rounded-lg overflow-hidden transition-all`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-3 px-4">Company Name</th>
                  <th className="py-3 px-3">Document Format</th>
                  <th className="py-3 px-3">Submission Date</th>
                  <th className="py-3 px-3 text-right">Items Quoted</th>
                  <th className="py-3 px-3">Extraction Status</th>
                  <th className="py-3 px-3 text-right">Confidence</th>
                  <th className="py-3 px-4 text-right">Required Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 text-xs">
                {vendors.map((vendor) => {
                  const qual = calculateVendorQualification(vendor.id, questions, responses);
                  const isExtracted =
                    vendor.processingStatus === 'extracted_NeedsReview' ||
                    vendor.processingStatus === 'verified';
                  const isProcessing = vendor.processingStatus === 'processing';
                  const isRejected = vendor.processingStatus === 'rejected';
                  const isSelected = sidePreviewVendor?.id === vendor.id;

                  return (
                    <tr
                      key={vendor.id}
                      onClick={() => setSidePreviewVendor(vendor)}
                      className={`hover:bg-slate-50/90 cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#6161F5]/[0.04]' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900">{vendor.name}</span>
                          {!qual.passedAllMandatory && (
                            <TrustBadge type="quality_disqualified" labelOverride="QA Disq." />
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {vendor.location} · {vendor.contactPerson}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                          <DocumentFormatIcon format={vendor.documentFormat} className="w-3.5 h-3.5" />
                          <span>{vendor.documentFormat}</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate max-w-[170px]">
                          {vendor.documentFileName}
                        </div>
                      </td>

                      <td className="py-3.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                        {vendor.submissionTimestamp}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                        {isExtracted ? `${vendor.itemsQuotedCount} / 30` : '— / 30'}
                      </td>

                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {vendor.processingStatus === 'unextracted' && (
                          <TrustBadge
                            type="requires_clarification"
                            labelOverride="Pending Extraction"
                          />
                        )}
                        {isProcessing && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#6161F5] font-medium">
                            <RefreshCw className="w-3 h-3 animate-spin" />
                            <span>Processing...</span>
                          </span>
                        )}
                        {vendor.processingStatus === 'extracted_NeedsReview' && (
                          <TrustBadge type="ai_generated" labelOverride="Extracted (Review)" />
                        )}
                        {vendor.processingStatus === 'verified' && (
                          <TrustBadge type="buyer_verified" labelOverride="Verified" />
                        )}
                        {isRejected && (
                          <TrustBadge type="not_comparable" labelOverride="Rejected" />
                        )}
                      </td>

                      <td className="py-3.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {isExtracted ? (
                          <span
                            className={`font-medium ${
                              vendor.extractionConfidencePct >= 90
                                ? 'text-emerald-700'
                                : vendor.extractionConfidencePct >= 80
                                ? 'text-slate-800'
                                : 'text-amber-700'
                            }`}
                          >
                            {vendor.extractionConfidencePct}%
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td
                        className="py-3.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          {vendor.processingStatus === 'unextracted' ? (
                            <button
                              onClick={() => onExtractVendor(vendor.id)}
                              className="px-2.5 py-1 text-[11px] font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Play className="w-2.5 h-2.5 fill-white" />
                              <span>Extract</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => onNavigate('document-intelligence', vendor.id)}
                              className="px-2.5 py-1 text-[11px] font-medium text-[#6161F5] bg-[#6161F5]/[0.06] hover:bg-[#6161F5]/10 border border-[#6161F5]/20 rounded inline-flex items-center gap-1 cursor-pointer"
                            >
                              <FileSearch className="w-3 h-3" />
                              <span>Review</span>
                            </button>
                          )}

                          <button
                            onClick={() => setSidePreviewVendor(vendor)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer"
                            title="Open Side Panel Preview"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onApproveVendorExtraction(vendor.id)}
                            disabled={!isExtracted}
                            title={
                              !isExtracted
                                ? 'Run extraction before approving'
                                : 'Approve Extracted Data'
                            }
                            className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              setClarifyingVendor(vendor);
                              setClarificationText(
                                `Dear ${vendor.contactPerson}, please confirm extracted values and exceptions on ${vendor.documentFileName}.`
                              );
                            }}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 rounded cursor-pointer"
                            title="Request Clarification"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => onRejectVendor(vendor.id)}
                            className="p-1.5 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                            title="Reject Submission"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Side Panel Document Preview (No unnecessary page jump required) */}
        {sidePreviewVendor && (
          <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-lg p-5 space-y-4">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200/80">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <DocumentFormatIcon format={sidePreviewVendor.documentFormat} />
                  <span>{sidePreviewVendor.name}</span>
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                  {sidePreviewVendor.documentFileName} ({sidePreviewVendor.documentSize})
                </div>
              </div>
              <button
                onClick={() => setSidePreviewVendor(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-[#18181B] text-slate-200 rounded-lg font-mono text-xs space-y-2 leading-relaxed">
              <div className="text-[10px] text-slate-400 border-b border-slate-800 pb-1 flex justify-between">
                <span>FORMAT: {sidePreviewVendor.documentFormat}</span>
                <span>SUBMITTED: {sidePreviewVendor.submissionTimestamp}</span>
              </div>
              <p className="text-slate-100">{sidePreviewVendor.documentScenarioSummary}</p>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-2.5 bg-slate-50 rounded border border-slate-200/80">
                <div className="text-[10px] text-slate-400">Payment & Freight</div>
                <div className="font-medium text-slate-800 mt-0.5">
                  {sidePreviewVendor.paymentTermsQuoted}
                </div>
                <div className="text-[11px] text-slate-500">
                  {sidePreviewVendor.freightPolicy}
                </div>
              </div>
              <div className="p-2.5 bg-slate-50 rounded border border-slate-200/80">
                <div className="text-[10px] text-slate-400">Questionnaire Status</div>
                <div className="font-medium text-slate-800 mt-0.5">
                  {sidePreviewVendor.questionnaireStatus}
                </div>
                <div className="text-[11px] text-slate-500">
                  Lead time: {sidePreviewVendor.leadTimeStated === false ? 'not stated' : `${sidePreviewVendor.deliveryLeadTimeDays} days`}
                </div>
              </div>
            </div>

            <div className="pt-2 flex flex-wrap items-center justify-between gap-2">
              <button
                onClick={() => onExtractVendor(sidePreviewVendor.id)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {sidePreviewVendor.processingStatus === 'unextracted'
                    ? 'Extract Document'
                    : 'Reprocess'}
                </span>
              </button>

              <button
                onClick={() => onNavigate('document-intelligence', sidePreviewVendor.id)}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Open Full Review</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Clarification Modal */}
      {clarifyingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Request Clarification — {clarifyingVendor.name}
              </h3>
              <button
                onClick={() => setClarifyingVendor(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="text-slate-500">
                To: <strong className="text-slate-800">{clarifyingVendor.contactPerson}</strong> (
                {clarifyingVendor.contactEmail})
              </div>
              <textarea
                rows={4}
                value={clarificationText}
                onChange={(e) => setClarificationText(e.target.value)}
                className="w-full p-3 border border-slate-300 rounded-md focus:outline-none focus:border-[#6161F5]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setClarifyingVendor(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onRequestVendorClarification(clarifyingVendor.id, clarificationText);
                  setClarifyingVendor(null);
                }}
                className="px-4 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md cursor-pointer"
              >
                Send Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Document Modal */}
      {uploadingVendor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">
                Upload Vendor Quotation
              </h3>
              <button
                onClick={() => setUploadingVendor(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">Supplier</label>
                <select
                  value={uploadingVendor.id}
                  onChange={(e) => {
                    const found = vendors.find((v) => v.id === e.target.value);
                    if (found) setUploadingVendor(found);
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-md"
                >
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} — {v.name} ({v.documentFormat})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">Vendor document (.xlsx, .pdf, .docx, .jpg/.png, .eml)</label>
                <input
                  type="file"
                  accept=".xlsx,.pdf,.docx,.jpg,.jpeg,.png,.eml"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  The file is sent to the ProcureIQ server and read by the AI. Nothing is pre-filled.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setUploadingVendor(null)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-md cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!uploadFile}
                onClick={() => {
                  if (!uploadFile) return;
                  onUploadRevision(uploadingVendor.id, uploadFile);
                  setUploadingVendor(null);
                }}
                className="px-4 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md cursor-pointer"
              >
                Upload & Extract
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
