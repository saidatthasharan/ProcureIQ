import React, { useState } from 'react';
import {
  ShieldCheck,
  Cpu,
  RotateCcw,
  Play,
} from 'lucide-react';
import { ScenarioConfig } from '../types/procurement';
import { TrustBadge } from './GovernanceUI';

interface SettingsViewProps {
  scenarioConfig: ScenarioConfig;
  onChangeScenarioConfig: (updated: ScenarioConfig) => void;
  onResetToUnextractedDemoState: () => void;
  onFastForwardExtractedDemoState: () => void;
  onNotify: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  scenarioConfig,
  onChangeScenarioConfig,
  onResetToUnextractedDemoState,
  onFastForwardExtractedDemoState,
  onNotify,
}) => {
  const [ocrThreshold, setOcrThreshold] = useState(85);
  const [gstBaselinePct, setGstBaselinePct] = useState(18);
  const [blockHistoricalRates, setBlockHistoricalRates] = useState(true);

  return (
    <div className="space-y-5">
      {/* Page Header & Demo State Controller */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200/90">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-[#18181B]">
            Governance & System Settings
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure OCR confidence thresholds, currency normalisation parameters, and demonstration workflow state
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={onResetToUnextractedDemoState}
            className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
            <span>Reset to Unextracted State</span>
          </button>
          <button
            onClick={onFastForwardExtractedDemoState}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#6161F5] hover:bg-[#4F4FE0] rounded-md inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3 h-3 fill-white" />
            <span>Fast-Forward: Extract All 5 Vendors</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Governance & Extraction Rules */}
        <div className="lg:col-span-6 bg-white rounded-lg border border-slate-200/90 p-5 space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-200/80 pb-3">
            <ShieldCheck className="w-4 h-4 text-[#6161F5]" />
            <h2 className="text-xs font-semibold text-[#18181B] uppercase tracking-wider">
              Document Extraction & Standardisation Guardrails
            </h2>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <div className="flex justify-between mb-1">
                <span className="font-medium text-slate-800">
                  Minimum OCR & Layout Confidence Threshold
                </span>
                <span className="font-mono font-semibold text-[#6161F5]">
                  {ocrThreshold}%
                </span>
              </div>
              <input
                type="range"
                min={60}
                max={98}
                value={ocrThreshold}
                onChange={(e) => setOcrThreshold(Number(e.target.value))}
                className="w-full accent-[#6161F5]"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Fields extracted below {ocrThreshold}% (such as Southern Box Mfg.&apos;s angled photo items 004, 015, 023 at 61.5%) are routed to the Exception Queue for manual verification.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Reference USD/INR Rate
                </label>
                <input
                  type="number"
                  step="0.25"
                  value={scenarioConfig.usdToInrRate}
                  onChange={(e) =>
                    onChangeScenarioConfig({
                      ...scenarioConfig,
                      usdToInrRate: Number(e.target.value),
                    })
                  }
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Standard HSN 4819 GST Rate (%)
                </label>
                <input
                  type="number"
                  value={gstBaselinePct}
                  onChange={(e) => setGstBaselinePct(Number(e.target.value))}
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>

            <label className="flex items-start gap-2.5 pt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={blockHistoricalRates}
                onChange={(e) => setBlockHistoricalRates(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 accent-[#6161F5]"
              />
              <div>
                <div className="font-medium text-[#18181B]">
                  Block Unconfirmed Previous-Year Pricing References
                </div>
                <div className="text-[11px] text-slate-500">
                  Prevents &ldquo;Same as 2025 contract&rdquo; statements (e.g., EcoWrap Items 009, 010, 018) from entering eligible bid comparisons until verified.
                </div>
              </div>
            </label>

            <div className="pt-2">
              <button
                onClick={() =>
                  onNotify(
                    `Governance thresholds saved (Min Confidence: ${ocrThreshold}%, FX: ₹${scenarioConfig.usdToInrRate.toFixed(2)}).`,
                    'success'
                  )
                }
                className="px-4 py-2 text-xs font-medium text-white bg-[#18181B] hover:bg-[#32323A] rounded-md cursor-pointer"
              >
                Save Governance Settings
              </button>
            </div>
          </div>
        </div>

        {/* Phase 2 Real LLM & Enterprise Integration Architecture */}
        <div className="lg:col-span-6 bg-white rounded-lg border border-slate-200/90 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#6161F5]" />
              <h2 className="text-xs font-semibold text-[#18181B] uppercase tracking-wider">
                AI & Enterprise Integration Interfaces
              </h2>
            </div>
            <TrustBadge type="ai_generated" labelOverride="MVP Architecture Status" />
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-md space-y-1">
              <div className="flex items-center justify-between font-semibold text-emerald-950">
                <span>1. Deterministic Normalisation & Scenario Engine</span>
                <span className="font-mono text-[11px] text-emerald-700">ACTIVE (LIVE)</span>
              </div>
              <p className="text-[11px] text-emerald-900">
                Full 30×5 commercial matrix, UOM/currency conversion math, mandatory quality gate enforcement, and CSV/JSON report generation run live in the browser.
              </p>
            </div>

            <div className="p-3 bg-[#FAFAFC] border border-slate-200/90 rounded-md space-y-1">
              <div className="flex items-center justify-between font-semibold text-[#18181B]">
                <span>2. Multimodal Document Extraction (ILlmDocumentExtractor)</span>
                <span className="font-mono text-[11px] text-[#6161F5]">
                  PHASE 2 INTEGRATION POINT
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                Currently seeded with the 5 Hyderabad Packaging vendor documents (.xlsx, .pdf, .docx, .jpg, .eml). Ready to connect to Gemini Multimodal Vision & Document AI for live PDF/image bounding-box extraction.
              </p>
            </div>

            <div className="p-3 bg-[#FAFAFC] border border-slate-200/90 rounded-md space-y-1">
              <div className="flex items-center justify-between font-semibold text-[#18181B]">
                <span>3. Conversational Analyst (ILlmProcurementAnalyst)</span>
                <span className="font-mono text-[11px] text-[#6161F5]">
                  PHASE 2 INTEGRATION POINT
                </span>
              </div>
              <p className="text-[11px] text-slate-600">
                Currently uses deterministic dataset computation with explicit Demo Mode labels. Ready to bind to server-side Gemini structured tool-calling over the live quotation state.
              </p>
            </div>

            <div className="p-3 bg-[#FAFAFC] border border-slate-200/90 rounded-md space-y-1">
              <div className="flex items-center justify-between font-semibold text-[#18181B]">
                <span>4. ERP Purchase Order Connector (SAP Ariba / S4HANA)</span>
                <span className="font-mono text-[11px] text-slate-500">PLANNED INTEGRATION</span>
              </div>
              <p className="text-[11px] text-slate-600">
                Award approval generates a buyer-verified schedule ready for SAP BAPI_PO_CREATE1 payload export.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
