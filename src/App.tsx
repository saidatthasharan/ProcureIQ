/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import {
  LayoutDashboard,
  FileSpreadsheet,
  Inbox,
  FileSearch,
  Table2,
  Bot,
  Sliders,
  Award,
  Download,
  Settings,
  Search,
  Bell,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCircle2,
  AlertTriangle,
  X,
  Menu,
  Play,
} from 'lucide-react';
import {
  WorkspaceId,
  LineItem,
  Vendor,
  VendorQuoteCell,
  ExtractionException,
  ConversionRule,
  QuestionnaireQuestion,
  VendorQuestionnaireResponse,
  ScenarioConfig,
} from './types/procurement';
import {
  PROJECT_METADATA,
  INITIAL_LINE_ITEMS,
  INITIAL_VENDORS,
  QUESTIONNAIRE_QUESTIONS,
  INITIAL_QUESTIONNAIRE_RESPONSES,
} from './data/seedData';
import { calculateVendorQualification } from './services/procurementEngine';
import { deriveVendorData } from './extraction/derive';
import { pendingCells, pendingVendor } from './extraction/pending';
import { extractDocument, fetchHealth, ApiError, type Health, type SourceView } from './services/extractionClient';
import { SourceEvidenceDrawer } from './components/GovernanceUI';
import { OverviewView } from './components/OverviewView';
import { RfxWorkspaceView } from './components/RfxWorkspaceView';
import { VendorResponsesView } from './components/VendorResponsesView';
import { DocumentIntelligenceView } from './components/DocumentIntelligenceView';
import { BidComparisonView } from './components/BidComparisonView';
import { AiAnalystView } from './components/AiAnalystView';
import { ScenarioSimulatorView } from './components/ScenarioSimulatorView';
import { AwardRecommendationView } from './components/AwardRecommendationView';
import { ReportsExportsView } from './components/ReportsExportsView';
import { SettingsView } from './components/SettingsView';

const NAV_ITEMS: {
  id: WorkspaceId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'rfx-workspace', label: 'RFx Workspace', icon: FileSpreadsheet },
  { id: 'vendor-responses', label: 'Vendor Responses', icon: Inbox },
  { id: 'document-intelligence', label: 'Document Intelligence', icon: FileSearch },
  { id: 'bid-comparison', label: 'Bid Comparison', icon: Table2 },
  { id: 'ai-analyst', label: 'AI Procurement Analyst', icon: Bot },
  { id: 'scenario-simulator', label: 'Scenario Simulator', icon: Sliders },
  { id: 'award-recommendations', label: 'Award Recommendations', icon: Award },
  { id: 'reports-exports', label: 'Reports & Exports', icon: Download },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceId>('overview');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Core Application State
  const [lineItems, setLineItems] = useState<LineItem[]>(INITIAL_LINE_ITEMS);
  // Nothing is pre-extracted. Only the list of invited suppliers is known at the start;
  // every price, term and exception below comes from a real extraction run.
  const [vendors, setVendors] = useState<Vendor[]>(() => INITIAL_VENDORS.map(pendingVendor));
  const [quoteCells, setQuoteCells] = useState<VendorQuoteCell[]>(() =>
    pendingCells(INITIAL_VENDORS, INITIAL_LINE_ITEMS)
  );
  const [exceptions, setExceptions] = useState<ExtractionException[]>([]);
  const [conversionRules, setConversionRules] = useState<ConversionRule[]>([]);
  const [questions, setQuestions] =
    useState<QuestionnaireQuestion[]>(QUESTIONNAIRE_QUESTIONS);
  // The questionnaire answers are SAMPLE INPUTS shipped with the project (not read from the
  // vendor files). They start unverified; the UI and reports say so.
  const [responses] = useState<VendorQuestionnaireResponse[]>(() =>
    INITIAL_QUESTIONNAIRE_RESPONSES.map((r) => ({ ...r, origin: 'sample_input' as const, buyerVerified: false }))
  );

  // Uploaded files and what the server parsed from them (kept for the side-by-side viewer).
  const vendorFiles = useRef<Record<string, File>>({});
  const [sourceViews, setSourceViews] = useState<Record<string, SourceView>>({});
  const [sourceImageUrls, setSourceImageUrls] = useState<Record<string, string>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const pickerVendor = useRef<string | null>(null);
  // In-memory audit trail of buyer and system actions in this session (not persisted; see docs).
  const [auditLog, setAuditLog] = useState<{ at: string; actor: 'buyer' | 'system'; action: string; detail: string }[]>([]);
  const audit = (actor: 'buyer' | 'system', action: string, detail: string) =>
    setAuditLog((prev) => [...prev, { at: new Date().toISOString(), actor, action, detail }]);

  React.useEffect(() => {
    fetchHealth().then(setHealth);
  }, []);

  // Scenario & Award state
  const [scenarioConfig, setScenarioConfig] = useState<ScenarioConfig>({
    id: 'default-split',
    name: 'Cheapest Quality-Qualified Split',
    strategy: 'cheapest_eligible_split',
    singleTargetVendorId: 'V-GLOBAL',
    includedVendorIds: INITIAL_VENDORS.map((v) => v.id),
    enforceMandatoryQualityGate: true,
    includeUnverifiedAssumptions: false,
    usdToInrRate: 83.5,
    applyGlobalFootnoteDiscount: true,
    standardFreightOverridePct: null,
    maxLeadTimeDaysFilter: 21,
  });
  const [awardApprovedByBuyer, setAwardApprovedByBuyer] = useState(false);

  // Navigation filter hints & Selected Vendor in Document Intelligence
  const [selectedDocVendorId, setSelectedDocVendorId] = useState<string>('V-APEX');
  const [bidComparisonFilterHint, setBidComparisonFilterHint] = useState<string | undefined>(
    undefined
  );

  // Evidence Drawer state
  const [evidenceTarget, setEvidenceTarget] = useState<{
    itemId: string;
    vendorId: string;
  } | null>(null);

  // Global Search, Notifications, Help, Project Selector & Toast state
  const [globalSearch, setGlobalSearch] = useState('');
  const [showNotifications, setShowNotifications] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isExtractingAll, setIsExtractingAll] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'info' | 'warning';
  } | null>(null);

  const showToast = (
    message: string,
    type: 'success' | 'info' | 'warning' = 'info'
  ) => {
    setToast({ message, type });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  };

  // Navigate helper with contextual filter hints
  const handleNavigate = (workspace: WorkspaceId, hint?: string) => {
    setActiveWorkspace(workspace);
    setMobileMenuOpen(false);
    if (workspace === 'document-intelligence' && hint && hint.startsWith('V-')) {
      setSelectedDocVendorId(hint);
    }
    if (workspace === 'bid-comparison') {
      setBidComparisonFilterHint(hint);
    }
  };

  const vendorQualifies = (vendorId: string) =>
    calculateVendorQualification(vendorId, questions, responses).passedAllMandatory;

  // Run the real pipeline for one vendor file: server parses + Gemini reads + server verifies evidence,
  // then the deterministic normaliser builds cells. Nothing is filled in if any step fails.
  const runExtraction = async (vendorId: string, file: File): Promise<boolean> => {
    const vendor = vendors.find((v) => v.id === vendorId);
    if (!vendor) return false;
    setVendors((prev) => prev.map((v) => (v.id === vendorId ? { ...v, processingStatus: 'processing' } : v)));
    try {
      const resp = await extractDocument(file, lineItems);
      const derived = deriveVendorData(vendor, resp.result, lineItems, {
        settings: { usdToInrRate: scenarioConfig.usdToInrRate, defaultGstRatePct: 18 },
        minConfidence: 0.85,
      });
      vendorFiles.current[vendorId] = file;
      setSourceViews((prev) => ({ ...prev, [vendorId]: resp.sourceView }));
      setSourceImageUrls((prev) => {
        if (prev[vendorId]) URL.revokeObjectURL(prev[vendorId]);
        const next = { ...prev };
        if (resp.sourceView.format === 'image') next[vendorId] = URL.createObjectURL(file);
        else delete next[vendorId];
        return next;
      });
      setQuoteCells((prev) => [...prev.filter((c) => c.vendorId !== vendorId), ...derived.cells]);
      setExceptions((prev) => [...prev.filter((e) => e.vendorId !== vendorId), ...derived.exceptions]);
      setConversionRules((prev) => [...prev.filter((r) => r.vendorId !== vendorId), ...derived.rules]);
      setVendors((prev) =>
        prev.map((v) =>
          v.id === vendorId
            ? {
                ...v,
                ...derived.vendorPatch,
                documentFileName: file.name,
                documentSize: `${(file.size / 1024).toFixed(0)} KB`,
                submissionTimestamp: new Date().toLocaleString(),
                clarificationRequested: false,
                clarificationNote: undefined,
              }
            : v
        )
      );
      audit('system', 'extraction', `${vendor.name}: ${file.name} read by ${resp.result.meta.model}; ${derived.exceptions.length} exceptions; sha256 ${resp.result.meta.sha256.slice(0, 12)}`);
      return true;
    } catch (e) {
      setVendors((prev) => prev.map((v) => (v.id === vendorId ? { ...v, processingStatus: vendor.processingStatus === 'processing' ? 'unextracted' : vendor.processingStatus } : v)));
      const msg = e instanceof ApiError ? e.message : 'Extraction failed unexpectedly.';
      audit('system', 'extraction_failed', `${vendor.name}: ${msg}`);
      showToast(`${vendor.shortName}: ${msg} No data was saved.`, 'warning');
      return false;
    }
  };

  const loadSampleFiles = async (): Promise<Record<string, File>> => {
    const out: Record<string, File> = {};
    try {
      const manifest = (await (await fetch('/sample-vendor-files/manifest.json')).json()) as Record<string, string>;
      for (const [vid, name] of Object.entries(manifest)) {
        const r = await fetch('/sample-vendor-files/' + encodeURIComponent(name));
        if (r.ok) out[vid] = new File([await r.blob()], name);
      }
    } catch {
      /* handled by caller */
    }
    return out;
  };

  // Extract a single vendor. If no file is attached yet, ask the user to choose one.
  const handleExtractVendor = (vendorId: string) => {
    const file = vendorFiles.current[vendorId];
    if (file) {
      void runExtraction(vendorId, file).then((ok) => ok && showToast('Extraction finished. Review the exceptions before relying on any price.', 'success'));
      return;
    }
    pickerVendor.current = vendorId;
    pickerRef.current?.click();
  };

  // Extract all vendors. Vendors without an uploaded file use the bundled sample files (clearly stated).
  const handleExtractAllVendors = async () => {
    setIsExtractingAll(true);
    const missing = vendors.filter((v) => !vendorFiles.current[v.id]);
    let usedSamples = false;
    if (missing.length) {
      const samples = await loadSampleFiles();
      for (const v of missing) if (samples[v.id]) { vendorFiles.current[v.id] = samples[v.id]; usedSamples = true; }
    }
    const targets = vendors.filter((v) => vendorFiles.current[v.id]);
    if (!targets.length) {
      setIsExtractingAll(false);
      showToast('No vendor files are available. Upload a file for a supplier first.', 'warning');
      return;
    }
    let ok = 0;
    // Two at a time keeps load on the AI service modest.
    for (let i = 0; i < targets.length; i += 2) {
      const results = await Promise.all(targets.slice(i, i + 2).map((v) => runExtraction(v.id, vendorFiles.current[v.id])));
      ok += results.filter(Boolean).length;
    }
    setIsExtractingAll(false);
    showToast(
      `${ok} of ${targets.length} vendor documents processed${usedSamples ? ' (bundled sample files were used for suppliers with no upload)' : ''}. Nothing is buyer-verified yet.`,
      ok === targets.length ? 'success' : 'warning'
    );
  };

  const handlePickedFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const vid = pickerVendor.current;
    e.target.value = '';
    if (file && vid) void handleUploadRevision(vid, file);
  };

  // Approve extracted vendor submission (a human action). Blocked while real exceptions are open.
  const handleApproveVendorExtraction = (vendorId: string) => {
    const v = vendors.find((vend) => vend.id === vendorId);
    const open = exceptions.filter((e) => e.vendorId === vendorId && e.severity !== 'Info' && e.status !== 'Resolved (Buyer Verified)');
    if (open.length) {
      showToast(`${open.length} open exception(s) for ${v?.shortName}. Resolve or verify them first.`, 'warning');
      return;
    }
    const qualifies = vendorQualifies(vendorId);
    setVendors((prev) =>
      prev.map((x) =>
        x.id === vendorId
          ? { ...x, processingStatus: 'verified', validationStatus: qualifies ? 'Verified' : 'Disqualified on Quality' }
          : x
      )
    );
    audit('buyer', 'approve_extraction', `${v?.name} extraction accepted by buyer`);
    showToast(`Marked ${v?.name} extraction as Buyer Verified.`, 'success');
  };

  // Reject vendor submission
  const handleRejectVendor = (vendorId: string) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? { ...v, processingStatus: 'rejected', validationStatus: 'Disqualified on Quality' }
          : v
      )
    );
    const v = vendors.find((vend) => vend.id === vendorId);
    audit('buyer', 'reject_submission', v?.name ?? vendorId);
    showToast(`Rejected submission from ${v?.name}.`, 'warning');
  };

  // Record a clarification request (the email itself is not sent; no mail integration).
  const handleRequestVendorClarification = (vendorId: string, note: string) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? { ...v, clarificationRequested: true, clarificationNote: note, validationStatus: 'Clarification Requested' }
          : v
      )
    );
    const v = vendors.find((vend) => vend.id === vendorId);
    audit('buyer', 'clarification_requested', `${v?.name}: ${note}`);
    showToast(`Clarification request recorded for ${v?.name}. (No email is sent from this prototype.)`, 'info');
  };

  // Upload a (revised) vendor document and run the real extraction on it.
  const handleUploadRevision = async (vendorId: string, file: File) => {
    const ok = await runExtraction(vendorId, file);
    if (ok) showToast(`Read ${file.name}. Review the exceptions before relying on any price.`, 'success');
  };

  // Buyer verifies one cell. A price must exist (extracted, provisional or typed in);
  // verifying never invents a price.
  const handleVerifyCell = (itemId: string, vendorId: string, newPriceInr?: number): boolean => {
    const cell = quoteCells.find((c) => c.itemId === itemId && c.vendorId === vendorId);
    if (!cell) return false;
    const resolved = newPriceInr ?? cell.normalisedUnitPriceInr ?? cell.provisionalUnitPriceInr ?? null;
    if (resolved === null || !Number.isFinite(resolved) || resolved <= 0) {
      showToast('There is no price on record for this cell. Enter the price you read in the source document, in INR per RFx unit, to verify it.', 'warning');
      return false;
    }
    const overridden = newPriceInr !== undefined && newPriceInr !== cell.normalisedUnitPriceInr;
    setQuoteCells((prev) =>
      prev.map((c) =>
        c.itemId === itemId && c.vendorId === vendorId
          ? {
              ...c,
              quoted: true,
              normalisedUnitPriceInr: resolved,
              originalExtractedPriceInr: overridden ? (c.normalisedUnitPriceInr ?? c.provisionalUnitPriceInr) : c.originalExtractedPriceInr,
              buyerConfirmedPriceInr: overridden ? resolved : c.buyerConfirmedPriceInr,
              buyerVerified: true,
              trust: 'buyer_verified',
              isComparable: true,
              blockReasons: [],
              validationStatus: 'buyer_verified',
            }
          : c
      )
    );
    setExceptions((prev) =>
      prev.map((e) => (e.itemId === itemId && e.vendorId === vendorId ? { ...e, status: 'Resolved (Buyer Verified)', resolvedValueInr: resolved } : e))
    );
    audit('buyer', overridden ? 'verify_cell_with_override' : 'verify_cell', `${vendorId} ${itemId}: INR ${resolved.toFixed(2)}${overridden ? ` (extracted value was ${cell.normalisedUnitPriceInr ?? cell.provisionalUnitPriceInr ?? 'none'})` : ''}`);
    showToast(`Buyer verified ${itemId} for ${vendorId} (₹${resolved.toFixed(2)}). Cell is now comparable.`, 'success');
    setEvidenceTarget(null);
    return true;
  };

  // Resolve an exception from the queue. Works for any exception; needs a price when the cell has none.
  const handleResolveException = (exceptionId: string, resolutionValueInr?: number) => {
    const exc = exceptions.find((e) => e.id === exceptionId);
    if (!exc) return;
    const cell = quoteCells.find((c) => c.itemId === exc.itemId && c.vendorId === exc.vendorId);
    if (cell && (cell.quoted || resolutionValueInr !== undefined)) {
      handleVerifyCell(exc.itemId, exc.vendorId, resolutionValueInr);
      return;
    }
    setExceptions((prev) => prev.map((e) => (e.id === exceptionId ? { ...e, status: 'Resolved (Buyer Verified)' } : e)));
    audit('buyer', 'acknowledge_exception', `${exceptionId}: ${exc.title}`);
    showToast(`Exception ${exceptionId} acknowledged. No price was added for this item.`, 'info');
  };

  // Buyer accepts a conversion rule. This confirms the ASSUMPTION; cells that were only blocked by
  // freight/tax assumptions become comparable; cells blocked by unknown units, currencies or
  // historical references stay blocked until a price is entered.
  const handleVerifyConversionRule = (ruleId: string) => {
    const rule = conversionRules.find((r) => r.id === ruleId);
    if (!rule) return;
    const softBlocks = new Set(['freight_not_quantified', 'tax_rate_missing']);
    let released = 0;
    setConversionRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, verificationStatus: 'Buyer Verified', blocksComparisonUntilVerified: false } : r)));
    setQuoteCells((prev) =>
      prev.map((c) => {
        if (c.vendorId !== rule.vendorId || !rule.affectedItemIds.includes(c.itemId)) return c;
        const reasons = c.blockReasons ?? [];
        const onlySoft = reasons.length > 0 && reasons.every((r) => softBlocks.has(r)) && c.provisionalUnitPriceInr !== null;
        if (onlySoft) {
          released++;
          return {
            ...c,
            normalisedUnitPriceInr: c.provisionalUnitPriceInr,
            isComparable: true,
            blockReasons: [],
            assumptions: [...(c.assumptions ?? []), `Conversion rule ${ruleId} accepted by buyer.`],
          };
        }
        return c;
      })
    );
    audit('buyer', 'verify_rule', `${ruleId} (${rule.category}) for ${rule.vendorId}; ${released} cell(s) released`);
    showToast(
      released
        ? `Verified rule ${ruleId}. ${released} item(s) are now comparable.`
        : `Verified rule ${ruleId}. Items blocked by unknown units, currencies or past-price references still need a price to be entered.`,
      'success'
    );
  };

  // Export the comparison matrix: one column per supplier actually in the project.
  const handleExportMatrixCsv = () => {
    const cols = vendors.map((v) => v.name);
    const headers = ['Item ID', 'SKU Code', 'Description', 'Category', 'Quantity', 'UOM', 'Baseline INR', ...cols.map((n) => `${n} INR`), ...cols.map((n) => `${n} status`)];
    const rows = lineItems.map((item) => {
      const cells = vendors.map((v) => quoteCells.find((c) => c.itemId === item.id && c.vendorId === v.id));
      return [
        item.id,
        item.code,
        `"${item.description.replace(/"/g, '""')}"`,
        `"${item.category}"`,
        item.quantity,
        item.standardUom,
        item.baselineUnitPriceInr,
        ...cells.map((c) => (c && c.isComparable && c.normalisedUnitPriceInr !== null ? c.normalisedUnitPriceInr.toString() : c?.quoted ? 'Blocked' : 'No usable quote')),
        ...cells.map((c) => (c ? `${c.trust ?? 'none'}${c.buyerVerified ? ' (buyer verified)' : ''}` : '')),
      ].join(',');
    });
    const csvContent = '﻿' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Hyderabad_Packaging_2026_Bid_Comparison.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${lineItems.length}×${vendors.length} comparison matrix to CSV.`, 'success');
  };

  // Global search matching
  const searchResults =
    globalSearch.trim().length > 1
      ? {
          items: lineItems
            .filter(
              (i) =>
                i.id.toLowerCase().includes(globalSearch.toLowerCase()) ||
                i.description.toLowerCase().includes(globalSearch.toLowerCase()) ||
                i.code.toLowerCase().includes(globalSearch.toLowerCase())
            )
            .slice(0, 4),
          vendors: vendors.filter((v) =>
            v.name.toLowerCase().includes(globalSearch.toLowerCase())
          ),
          exceptions: exceptions
            .filter(
              (e) =>
                e.title.toLowerCase().includes(globalSearch.toLowerCase()) ||
                e.id.toLowerCase().includes(globalSearch.toLowerCase())
            )
            .slice(0, 3),
        }
      : null;

  // Compute badges for sidebar
  const unextractedCount = vendors.filter(
    (v) => v.processingStatus === 'unextracted'
  ).length;
  const openExceptionsCount = exceptions.filter(
    (e) => e.status !== 'Resolved (Buyer Verified)'
  ).length;

  const activeNavLabel =
    NAV_ITEMS.find((n) => n.id === activeWorkspace)?.label || 'Overview';

  // Evidence Drawer target lookup
  const drawerItem = evidenceTarget
    ? lineItems.find((i) => i.id === evidenceTarget.itemId) || null
    : null;
  const drawerVendor = evidenceTarget
    ? vendors.find((v) => v.id === evidenceTarget.vendorId) || null
    : null;
  const drawerCell = evidenceTarget
    ? quoteCells.find(
        (c) =>
          c.itemId === evidenceTarget.itemId &&
          c.vendorId === evidenceTarget.vendorId
      ) || null
    : null;
  const drawerRule = drawerCell?.conversionRuleId
    ? conversionRules.find((r) => r.id === drawerCell.conversionRuleId)
    : undefined;
  const drawerVendorQual = drawerVendor
    ? calculateVendorQualification(drawerVendor.id, questions, responses)
        .passedAllMandatory
    : true;

  return (
    <div className="min-h-screen flex bg-[#FAFAFC] text-[#18181B]">
      {/* Slim Collapsible Enterprise Sidebar (232px expanded, 64px collapsed) */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 bg-[#18181B] text-slate-300 flex flex-col justify-between border-r border-slate-800/80 transition-all duration-200 lg:translate-x-0 lg:static lg:shrink-0 ${
          sidebarCollapsed ? 'w-16' : 'w-[232px]'
        } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div>
          {/* Brand Header & Collapse Control */}
          <div className="h-14 px-3.5 flex items-center justify-between border-b border-slate-800/80">
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-7 h-7 rounded-md bg-[#6161F5] flex items-center justify-center text-white font-semibold text-xs shrink-0">
                PQ
              </div>
              {!sidebarCollapsed && (
                <div className="truncate">
                  <div className="text-sm font-semibold tracking-tight text-white leading-none">
                    ProcureIQ
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                    Autonomous Sourcing
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden lg:inline-flex p-1 text-slate-400 hover:text-white rounded cursor-pointer"
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 10 Navigation Items */}
          <nav className="p-2 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeWorkspace === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  title={sidebarCollapsed ? item.label : undefined}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#6161F5] text-white'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </div>
                  {!sidebarCollapsed &&
                    item.id === 'vendor-responses' &&
                    unextractedCount > 0 && (
                      <span
                        className={`px-1.5 py-0.2 text-[10px] font-mono rounded ${
                          isActive
                            ? 'bg-black/25 text-white'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {unextractedCount}
                      </span>
                    )}
                  {!sidebarCollapsed &&
                    item.id === 'document-intelligence' &&
                    openExceptionsCount > 0 && (
                      <span
                        className={`px-1.5 py-0.2 text-[10px] font-mono rounded ${
                          isActive
                            ? 'bg-black/25 text-white'
                            : 'bg-rose-500/20 text-rose-300'
                        }`}
                      >
                        {openExceptionsCount}
                      </span>
                    )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Compact Sidebar Footer */}
        {!sidebarCollapsed ? (
          <div className="p-3 m-2.5 rounded-md bg-white/[0.04] border border-slate-800/90 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between text-slate-400">
              <span>Event Status</span>
              <span className="font-mono text-emerald-400">INR · 30 SKUs</span>
            </div>
            <div className="font-medium text-white truncate">
              Hyderabad Packaging – 2026
            </div>
            <div className="text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/80">
              <span>Extracted Quotes</span>
              <span className="font-mono text-white">{5 - unextractedCount} / 5</span>
            </div>
          </div>
        ) : (
          <div className="p-2 flex justify-center border-t border-slate-800/80">
            <span
              className="text-[10px] font-mono text-emerald-400"
              title={`${5 - unextractedCount}/5 Extracted`}
            >
              {5 - unextractedCount}/5
            </span>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Slim Enterprise Top Navigation Bar (Section 3) */}
        <header className="h-14 bg-white border-b border-slate-200/90 px-4 lg:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
          {/* Left: Mobile toggle + Breadcrumb Navigation + Project Selector */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:bg-slate-100 rounded-md"
            >
              <Menu className="w-4 h-4" />
            </button>

            {/* Breadcrumb Navigation */}
            <nav
              aria-label="Breadcrumb"
              className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 truncate"
            >
              <button
                onClick={() => handleNavigate('overview')}
                className="hover:text-[#18181B] transition-colors cursor-pointer"
              >
                ProcureIQ
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Active procurement project selector"
                defaultValue="PRJ-HYD-2026-004"
                onChange={(e) => {
                  if (e.target.value !== 'PRJ-HYD-2026-004') {
                    showToast(
                      'Switched view back to active project: Hyderabad Packaging Procurement – 2026.',
                      'info'
                    );
                    e.target.value = 'PRJ-HYD-2026-004';
                  }
                }}
                className="py-1 px-2 text-xs font-medium text-[#18181B] bg-[#FAFAFC] border border-slate-200/90 rounded-md focus:outline-none focus:border-[#6161F5] cursor-pointer"
              >
                <option value="PRJ-HYD-2026-004">
                  Hyderabad Packaging – 2026
                </option>
                <option value="PRJ-PUN-2026-001">
                  Pune Fasteners Q4 (Archived)
                </option>
              </select>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-semibold text-[#18181B] truncate">
                {activeNavLabel}
              </span>
            </nav>
          </div>

          {/* Center: Global Search */}
          <div className="relative flex-1 max-w-sm hidden md:block">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="Search SKU (PKG-HYD-012), vendor, or exception..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#FAFAFC] border border-slate-200/90 rounded-md focus:bg-white focus:outline-none focus:border-[#6161F5]"
            />
            {searchResults && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-lg shadow-xl p-3 z-50 space-y-2 text-xs">
                <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-100 pb-1">
                  <span>Quick Jump Search Results</span>
                  <button
                    onClick={() => setGlobalSearch('')}
                    className="text-slate-500 hover:text-slate-800"
                  >
                    Clear
                  </button>
                </div>
                {searchResults.items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setGlobalSearch('');
                      handleNavigate('bid-comparison');
                      setEvidenceTarget({ itemId: item.id, vendorId: 'V-APEX' });
                    }}
                    className="w-full text-left p-1.5 hover:bg-slate-50 rounded flex items-center justify-between cursor-pointer"
                  >
                    <span className="font-medium text-[#18181B] truncate">
                      <strong className="font-mono text-[#6161F5]">{item.id}</strong> —{' '}
                      {item.description}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0 ml-2">
                      {item.quantity} {item.standardUom}
                    </span>
                  </button>
                ))}
                {searchResults.vendors.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setGlobalSearch('');
                      handleNavigate('document-intelligence', v.id);
                    }}
                    className="w-full text-left p-1.5 hover:bg-slate-50 rounded flex items-center justify-between cursor-pointer"
                  >
                    <span className="font-medium text-[#18181B]">
                      Supplier: {v.name} ({v.documentFormat})
                    </span>
                    <span className="text-[11px] text-[#6161F5]">Inspect &rarr;</span>
                  </button>
                ))}
                {searchResults.exceptions.map((exc) => (
                  <button
                    key={exc.id}
                    onClick={() => {
                      setGlobalSearch('');
                      handleNavigate('document-intelligence', exc.vendorId);
                    }}
                    className="w-full text-left p-1.5 hover:bg-rose-50 rounded flex items-center justify-between cursor-pointer"
                  >
                    <span className="font-medium text-rose-800 truncate">
                      {exc.id}: {exc.title}
                    </span>
                    <span className="text-[11px] font-mono text-rose-600">{exc.severity}</span>
                  </button>
                ))}
                {searchResults.items.length === 0 &&
                  searchResults.vendors.length === 0 &&
                  searchResults.exceptions.length === 0 && (
                    <div className="text-slate-400 py-2 text-center">
                      No matching items, vendors, or exceptions found.
                    </div>
                  )}
              </div>
            )}
          </div>

          {/* Right: Quick Extract Action, Notifications, Help, User Profile */}
          <div className="flex items-center gap-1.5 shrink-0">
            {unextractedCount > 0 && (
              <button
                onClick={handleExtractAllVendors}
                className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#6161F5] bg-[#6161F5]/[0.08] hover:bg-[#6161F5]/[0.14] border border-[#6161F5]/20 rounded-md transition-colors cursor-pointer"
                title="Fast-forward demo by extracting all 5 vendor submissions"
              >
                <Play className="w-3 h-3 fill-[#6161F5]" />
                <span>Extract All ({unextractedCount})</span>
              </button>
            )}

            {/* Notification Bell */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  setShowProfileMenu(false);
                }}
                className="p-1.5 text-slate-500 hover:text-[#18181B] hover:bg-slate-100 rounded-md relative cursor-pointer"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {openExceptionsCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-600 absolute top-1.5 right-1.5" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-lg shadow-xl p-3.5 z-50 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <span className="font-semibold text-[#18181B]">
                      Governance Alerts ({openExceptionsCount})
                    </span>
                    <button
                      onClick={() => setShowNotifications(false)}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {exceptions.slice(0, 4).map((e) => (
                      <div
                        key={e.id}
                        onClick={() => {
                          setShowNotifications(false);
                          handleNavigate('document-intelligence', e.vendorId);
                        }}
                        className="p-2 rounded-md bg-[#FAFAFC] hover:bg-[#6161F5]/[0.06] border border-slate-200/80 cursor-pointer"
                      >
                        <div className="font-medium text-[#18181B]">
                          {e.id} · {e.severity}
                        </div>
                        <div className="text-[11px] text-slate-500 line-clamp-2">
                          {e.title}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Help Button */}
            <button
              onClick={() => setShowHelpModal(true)}
              className="p-1.5 text-slate-500 hover:text-[#18181B] hover:bg-slate-100 rounded-md cursor-pointer"
              aria-label="Help & Demo Guide"
              title="Walkthrough Guide"
            >
              <HelpCircle className="w-4 h-4" />
            </button>

            {/* User Profile */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowProfileMenu(!showProfileMenu);
                  setShowNotifications(false);
                }}
                className="flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <div className="w-6 h-6 rounded-full bg-[#18181B] text-white text-[11px] font-semibold flex items-center justify-center">
                  VR
                </div>
                <div className="hidden sm:block text-left">
                  <div className="text-xs font-medium text-[#18181B] leading-none">
                    Vikramaditya Rao
                  </div>
                </div>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-lg shadow-xl p-3 z-50 space-y-1.5 text-xs">
                  <div className="pb-2 border-b border-slate-100">
                    <div className="font-semibold text-[#18181B]">
                      {PROJECT_METADATA.buyerLead}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Strategic Sourcing · Hyderabad Plant
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      handleNavigate('settings');
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-slate-100 rounded text-slate-700 cursor-pointer"
                  >
                    Governance & Threshold Settings
                  </button>
                  <button
                    onClick={() => {
                      setShowProfileMenu(false);
                      handleNavigate('reports-exports');
                    }}
                    className="w-full text-left px-2.5 py-1.5 hover:bg-slate-100 rounded text-slate-700 cursor-pointer"
                  >
                    Download Audit Package (.CSV / .JSON)
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Workspace Container */}
        <main className="flex-1 p-5 lg:p-6 max-w-[1600px] w-full mx-auto">
          {activeWorkspace === 'overview' && (
            <OverviewView
              lineItems={lineItems}
              vendors={vendors}
              quoteCells={quoteCells}
              exceptions={exceptions}
              questions={questions}
              responses={responses}
              onNavigate={handleNavigate}
              onExtractAllVendors={handleExtractAllVendors}
              isExtractingAll={isExtractingAll}
              auditLog={auditLog}
            />
          )}

          {activeWorkspace === 'rfx-workspace' && (
            <RfxWorkspaceView
              lineItems={lineItems}
              questions={questions}
              vendors={vendors}
              onUpdateLineItem={(updated) =>
                setLineItems((prev) =>
                  prev.map((item) => (item.id === updated.id ? updated : item))
                )
              }
              onAddLineItem={(newItem) => setLineItems((prev) => [...prev, newItem])}
              onApproveAllItems={() =>
                setLineItems((prev) =>
                  prev.map((item) => ({ ...item, approvalStatus: 'buyer_approved' }))
                )
              }
              onToggleMandatoryQuestion={(questionId) =>
                setQuestions((prev) =>
                  prev.map((q) =>
                    q.id === questionId
                      ? { ...q, mandatoryCriterion: !q.mandatoryCriterion }
                      : q
                  )
                )
              }
              onAddQuestion={(q) => setQuestions((prev) => [...prev, q])}
              onNotify={showToast}
            />
          )}

          {activeWorkspace === 'vendor-responses' && (
            <VendorResponsesView
              vendors={vendors}
              questions={questions}
              responses={responses}
              onExtractVendor={handleExtractVendor}
              onExtractAllVendors={handleExtractAllVendors}
              onApproveVendorExtraction={handleApproveVendorExtraction}
              onRejectVendor={handleRejectVendor}
              onRequestVendorClarification={handleRequestVendorClarification}
              onUploadRevision={handleUploadRevision}
              onNavigate={handleNavigate}
            />
          )}

          {activeWorkspace === 'document-intelligence' && (
            <DocumentIntelligenceView
              vendors={vendors}
              lineItems={lineItems}
              quoteCells={quoteCells}
              exceptions={exceptions}
              conversionRules={conversionRules}
              selectedVendorId={selectedDocVendorId}
              onSelectVendor={setSelectedDocVendorId}
              onExtractVendor={handleExtractVendor}
              onExtractAllVendors={handleExtractAllVendors}
              onResolveException={handleResolveException}
              onVerifyConversionRule={handleVerifyConversionRule}
              onOpenCellEvidence={(itemId, vendorId) =>
                setEvidenceTarget({ itemId, vendorId })
              }
              sourceViews={sourceViews}
              sourceImageUrls={sourceImageUrls}
            />
          )}

          {activeWorkspace === 'bid-comparison' && (
            <BidComparisonView
              lineItems={lineItems}
              vendors={vendors}
              quoteCells={quoteCells}
              questions={questions}
              responses={responses}
              conversionRules={conversionRules}
              initialFilterHint={bidComparisonFilterHint}
              onOpenCellEvidence={(itemId, vendorId) =>
                setEvidenceTarget({ itemId, vendorId })
              }
              onExtractAllVendors={handleExtractAllVendors}
              onToggleMandatoryQuestion={(questionId) =>
                setQuestions((prev) =>
                  prev.map((q) =>
                    q.id === questionId
                      ? { ...q, mandatoryCriterion: !q.mandatoryCriterion }
                      : q
                  )
                )
              }
              onExportMatrixCsv={handleExportMatrixCsv}
            />
          )}

          {activeWorkspace === 'ai-analyst' && (
            <AiAnalystView
              lineItems={lineItems}
              vendors={vendors}
              quoteCells={quoteCells}
              questions={questions}
              responses={responses}
              exceptions={exceptions}
              usdToInrRate={scenarioConfig.usdToInrRate}
              health={health}
            />
          )}

          {activeWorkspace === 'scenario-simulator' && (
            <ScenarioSimulatorView
              lineItems={lineItems}
              vendors={vendors}
              quoteCells={quoteCells}
              questions={questions}
              responses={responses}
              exceptions={exceptions}
              scenarioConfig={scenarioConfig}
              onChangeScenarioConfig={setScenarioConfig}
              onPromoteToAward={() => {
                setActiveWorkspace('award-recommendations');
                showToast(
                  `Promoted "${scenarioConfig.name}" to VP Award Recommendation package.`,
                  'success'
                );
              }}
              onExtractAllVendors={handleExtractAllVendors}
            />
          )}

          {activeWorkspace === 'award-recommendations' && (
            <AwardRecommendationView
              lineItems={lineItems}
              vendors={vendors}
              quoteCells={quoteCells}
              questions={questions}
              responses={responses}
              exceptions={exceptions}
              scenarioConfig={scenarioConfig}
              awardApprovedByBuyer={awardApprovedByBuyer}
              onApproveAwardByBuyer={() => {
                setAwardApprovedByBuyer(true);
                showToast(
                  'VP Award Recommendation formally approved by buyer for ERP Purchase Order preparation.',
                  'success'
                );
              }}
              onOpenCellEvidence={(itemId, vendorId) =>
                setEvidenceTarget({ itemId, vendorId })
              }
              onExportRecommendationCsv={handleExportMatrixCsv}
              onNotify={showToast}
            />
          )}

          {activeWorkspace === 'reports-exports' && (
            <ReportsExportsView
              lineItems={lineItems}
              vendors={vendors}
              quoteCells={quoteCells}
              questions={questions}
              responses={responses}
              exceptions={exceptions}
              scenarioConfig={scenarioConfig}
              onNotify={showToast}
            />
          )}

          {activeWorkspace === 'settings' && (
            <SettingsView
              scenarioConfig={scenarioConfig}
              onChangeScenarioConfig={setScenarioConfig}
              onResetToUnextractedDemoState={() => {
                setVendors(INITIAL_VENDORS.map(pendingVendor));
                setQuoteCells(pendingCells(INITIAL_VENDORS, INITIAL_LINE_ITEMS));
                setExceptions([]);
                setConversionRules([]);
                setSourceViews({});
                setSourceImageUrls({});
                vendorFiles.current = {};
                setAwardApprovedByBuyer(false);
                audit('buyer', 'reset', 'All extracted data cleared');
                showToast('Cleared all extracted data. Suppliers are back to Pending Extraction.', 'info');
              }}
              onFastForwardExtractedDemoState={handleExtractAllVendors}
              onNotify={showToast}
              health={health}
            />
          )}
        </main>
      </div>

      {/* Shared Source Evidence & Normalisation Math Drawer */}
      <SourceEvidenceDrawer
        isOpen={Boolean(evidenceTarget)}
        onClose={() => setEvidenceTarget(null)}
        item={drawerItem}
        vendor={drawerVendor}
        cell={drawerCell}
        conversionRule={drawerRule}
        usdToInrRate={scenarioConfig.usdToInrRate}
        sourceImageUrl={evidenceTarget ? sourceImageUrls[evidenceTarget.vendorId] : undefined}
        isVendorQualityQualified={drawerVendorQual}
        onVerifyCell={handleVerifyCell}
        onRequestClarification={(vendorId, itemId, note) => {
          handleRequestVendorClarification(vendorId, `[${itemId}] ${note}`);
          setEvidenceTarget(null);
        }}
      />

      {/* Hidden file picker used by the Extract buttons when no file is attached yet */}
      <input
        ref={pickerRef}
        type="file"
        accept=".xlsx,.pdf,.docx,.jpg,.jpeg,.png,.eml"
        className="hidden"
        onChange={handlePickedFile}
      />

      {/* Help & Product Walkthrough Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-lg border border-slate-200 max-w-2xl w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold text-[#18181B]">
                ProcureIQ — Enterprise Procurement Intelligence Walkthrough
              </h3>
              <button
                onClick={() => setShowHelpModal(false)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
              <p>
                <strong className="text-[#18181B]">1. RFx Authoring (RFx Workspace):</strong>{' '}
                Use the conversational AI Copilot on the left and live RFQ preview on the right to inspect the 30 corrugated packaging line items and 12-point vendor qualification questionnaire.
              </p>
              <p>
                <strong className="text-[#18181B]">2. Multi-Format Ingestion (Vendor Responses):</strong>{' '}
                All 5 vendor submissions (.xlsx, .pdf, .docx, .jpg rate card photo, .eml email) load initially in <em>Pending Extraction</em> state. Click <strong>Preview</strong> to open the inline side document viewer or <strong>Extract</strong> to parse fields.
              </p>
              <p>
                <strong className="text-[#18181B]">3. Document Intelligence & Standardisation Engine:</strong>{' '}
                Review original vendor documents side-by-side with extracted structured fields, filter by confidence/exceptions, and verify conversion rules.
              </p>
              <p>
                <strong className="text-[#18181B]">4. Side-by-Side Bid Comparison & Questionnaire:</strong>{' '}
                Compare 30 items × 5 vendors with sticky item columns, filter pills, and 1-click source evidence inspection.
              </p>
              <p>
                <strong className="text-[#18181B]">5. AI Analyst, Scenario Simulator & Award Memo:</strong>{' '}
                Run structured analytical queries, simulate single vs. split awards with before/after impact comparisons, and approve/export the executive decision package.
              </p>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-1.5 text-xs font-medium text-white bg-[#6161F5] rounded-md cursor-pointer"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification Banner */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md bg-[#18181B] text-white px-4 py-3 rounded-lg shadow-xl border border-slate-700 flex items-center gap-3 text-xs">
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : toast.type === 'warning' ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#6161F5] shrink-0" />
          )}
          <span className="leading-snug">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="text-slate-400 hover:text-white ml-auto"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
