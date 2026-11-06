/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
  INITIAL_QUOTE_CELLS,
  INITIAL_EXCEPTIONS,
  INITIAL_CONVERSION_RULES,
  QUESTIONNAIRE_QUESTIONS,
  INITIAL_QUESTIONNAIRE_RESPONSES,
} from './data/seedData';
import { calculateVendorQualification } from './services/procurementEngine';
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
  const [vendors, setVendors] = useState<Vendor[]>(INITIAL_VENDORS);
  const [quoteCells, setQuoteCells] = useState<VendorQuoteCell[]>(INITIAL_QUOTE_CELLS);
  const [exceptions, setExceptions] = useState<ExtractionException[]>(INITIAL_EXCEPTIONS);
  const [conversionRules, setConversionRules] =
    useState<ConversionRule[]>(INITIAL_CONVERSION_RULES);
  const [questions, setQuestions] =
    useState<QuestionnaireQuestion[]>(QUESTIONNAIRE_QUESTIONS);
  const [responses] = useState<VendorQuestionnaireResponse[]>(
    INITIAL_QUESTIONNAIRE_RESPONSES
  );

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

  // Extract single vendor document
  const handleExtractVendor = (vendorId: string) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId ? { ...v, processingStatus: 'processing' } : v
      )
    );

    setTimeout(() => {
      setVendors((prev) =>
        prev.map((v) => {
          if (v.id !== vendorId) return v;
          const nextValidation: Vendor['validationStatus'] =
            v.id === 'V-SOUTHERN'
              ? 'Disqualified on Quality'
              : v.id === 'V-ECOWRAP' || v.id === 'V-PRIMEPACK' || v.id === 'V-GLOBAL'
              ? 'Exceptions Found'
              : 'Verified';
          return {
            ...v,
            processingStatus: 'extracted_NeedsReview',
            validationStatus: nextValidation,
          };
        })
      );
      const targetVendor = vendors.find((v) => v.id === vendorId);
      showToast(
        `Extracted ${targetVendor?.itemsQuotedCount || 30} items from ${targetVendor?.documentFileName} (${targetVendor?.extractionConfidencePct}% confidence).`,
        'success'
      );
    }, 350);
  };

  // Extract all 5 vendor documents
  const handleExtractAllVendors = () => {
    setIsExtractingAll(true);
    setVendors((prev) =>
      prev.map((v) =>
        v.processingStatus === 'unextracted'
          ? { ...v, processingStatus: 'processing' }
          : v
      )
    );

    setTimeout(() => {
      setVendors((prev) =>
        prev.map((v) => ({
          ...v,
          processingStatus:
            v.processingStatus === 'verified' ? 'verified' : 'extracted_NeedsReview',
          validationStatus:
            v.id === 'V-SOUTHERN'
              ? 'Disqualified on Quality'
              : v.id === 'V-ECOWRAP' || v.id === 'V-PRIMEPACK' || v.id === 'V-GLOBAL'
              ? 'Exceptions Found'
              : 'Verified',
        }))
      );
      setIsExtractingAll(false);
      showToast(
        'Processed all 5 vendor submissions (.xlsx, .pdf, .docx, .jpg, .eml). 139 quoted cells extracted; 8 exceptions queued.',
        'success'
      );
    }, 450);
  };

  // Approve extracted vendor submission
  const handleApproveVendorExtraction = (vendorId: string) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              processingStatus: 'verified',
              validationStatus:
                v.id === 'V-SOUTHERN' ? 'Disqualified on Quality' : 'Verified',
            }
          : v
      )
    );
    const v = vendors.find((vend) => vend.id === vendorId);
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
    showToast(`Rejected submission from ${v?.name}.`, 'warning');
  };

  // Request vendor clarification
  const handleRequestVendorClarification = (vendorId: string, note: string) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              clarificationRequested: true,
              clarificationNote: note,
              validationStatus: 'Clarification Requested',
            }
          : v
      )
    );
    const v = vendors.find((vend) => vend.id === vendorId);
    showToast(`Clarification request dispatched to ${v?.name}.`, 'info');
  };

  // Upload revision document
  const handleUploadRevision = (vendorId: string, fileName: string) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId
          ? {
              ...v,
              documentFileName: fileName,
              submissionTimestamp: 'Just now (Revision)',
              processingStatus: 'extracted_NeedsReview',
            }
          : v
      )
    );
    showToast(`Uploaded ${fileName} and extracted updated fields.`, 'success');
  };

  // Verify individual quote cell & unblock comparison
  const handleVerifyCell = (
    itemId: string,
    vendorId: string,
    newPriceInr?: number
  ) => {
    setVendors((prev) =>
      prev.map((v) =>
        v.id === vendorId && v.processingStatus === 'unextracted'
          ? { ...v, processingStatus: 'extracted_NeedsReview' }
          : v
      )
    );

    setQuoteCells((prev) =>
      prev.map((cell) => {
        if (cell.itemId !== itemId || cell.vendorId !== vendorId) return cell;
        const resolvedPrice =
          newPriceInr ??
          cell.normalisedUnitPriceInr ??
          cell.provisionalUnitPriceInr ??
          0;
        return {
          ...cell,
          normalisedUnitPriceInr: resolvedPrice,
          buyerVerified: true,
          isComparable: true,
          validationStatus: 'buyer_verified',
        };
      })
    );

    setExceptions((prev) =>
      prev.map((exc) =>
        exc.itemId === itemId && exc.vendorId === vendorId
          ? { ...exc, status: 'Resolved (Buyer Verified)' }
          : exc
      )
    );

    showToast(
      `Buyer verified ${itemId} for ${vendorId} (${
        newPriceInr ? '₹' + newPriceInr.toFixed(2) : 'Approved'
      }). Cell is now comparable.`,
      'success'
    );
    setEvidenceTarget(null);
  };

  // Resolve exception from Exception Queue with full multi-item & rule synchronization
  const handleResolveException = (
    exceptionId: string,
    resolutionValueInr?: number
  ) => {
    const targetExc = exceptions.find((e) => e.id === exceptionId);
    if (!targetExc) return;

    setExceptions((prev) =>
      prev.map((e) =>
        e.id === exceptionId ? { ...e, status: 'Resolved (Buyer Verified)' } : e
      )
    );

    if (exceptionId === 'EXC-002') {
      // Unblock all 3 EcoWrap historical rate items (PKG-HYD-009, PKG-HYD-010, PKG-HYD-018) and verify CONV-008
      const historicalItems = ['PKG-HYD-009', 'PKG-HYD-010', 'PKG-HYD-018'];
      setQuoteCells((prev) =>
        prev.map((cell) => {
          if (cell.vendorId === 'V-ECOWRAP' && historicalItems.includes(cell.itemId)) {
            return {
              ...cell,
              normalisedUnitPriceInr:
                cell.normalisedUnitPriceInr ?? cell.provisionalUnitPriceInr ?? 0,
              buyerVerified: true,
              isComparable: true,
              validationStatus: 'buyer_verified',
            };
          }
          return cell;
        })
      );
      setConversionRules((prev) =>
        prev.map((r) =>
          r.id === 'CONV-008'
            ? {
                ...r,
                verificationStatus: 'Buyer Verified',
                blocksComparisonUntilVerified: false,
              }
            : r
        )
      );
      showToast(
        'Verified EcoWrap Q3 2025 PO rates for PKG-HYD-009, PKG-HYD-010, and PKG-HYD-018.',
        'success'
      );
      return;
    }

    if (exceptionId === 'EXC-001') {
      setConversionRules((prev) =>
        prev.map((r) =>
          r.id === 'CONV-007'
            ? {
                ...r,
                verificationStatus: 'Buyer Verified',
                blocksComparisonUntilVerified: false,
              }
            : r
        )
      );
    }

    if (exceptionId === 'EXC-005') {
      setConversionRules((prev) =>
        prev.map((r) =>
          r.id === 'CONV-004'
            ? {
                ...r,
                verificationStatus: 'Buyer Verified',
                blocksComparisonUntilVerified: false,
              }
            : r
        )
      );
    }

    if (exceptionId === 'EXC-004') {
      const lowOcrItems = ['PKG-HYD-004', 'PKG-HYD-015', 'PKG-HYD-023'];
      setQuoteCells((prev) =>
        prev.map((cell) => {
          if (cell.vendorId === 'V-SOUTHERN' && lowOcrItems.includes(cell.itemId)) {
            return {
              ...cell,
              buyerVerified: true,
              validationStatus: 'buyer_verified',
            };
          }
          return cell;
        })
      );
      showToast(
        'Buyer verified Southern Box Mfg. low-OCR handwritten items (PKG-HYD-004, 015, 023).',
        'success'
      );
      return;
    }

    if (resolutionValueInr !== undefined) {
      handleVerifyCell(targetExc.itemId, targetExc.vendorId, resolutionValueInr);
    } else {
      showToast(`Exception ${exceptionId} marked as resolved.`, 'success');
    }
  };

  // Verify conversion rule in Standardisation Engine & sync linked Exceptions
  const handleVerifyConversionRule = (ruleId: string) => {
    const rule = conversionRules.find((r) => r.id === ruleId);
    setConversionRules((prev) =>
      prev.map((r) =>
        r.id === ruleId
          ? {
              ...r,
              verificationStatus: 'Buyer Verified',
              blocksComparisonUntilVerified: false,
            }
          : r
      )
    );

    if (rule) {
      setQuoteCells((prev) =>
        prev.map((c) => {
          if (
            c.vendorId === rule.vendorId &&
            rule.affectedItemIds.includes(c.itemId) &&
            c.quoted
          ) {
            return {
              ...c,
              normalisedUnitPriceInr:
                c.normalisedUnitPriceInr ?? c.provisionalUnitPriceInr,
              isComparable: true,
              buyerVerified: true,
              validationStatus: 'buyer_verified',
            };
          }
          return c;
        })
      );

      // Sync corresponding exceptions if applicable
      const linkedExcId =
        ruleId === 'CONV-007'
          ? 'EXC-001'
          : ruleId === 'CONV-008'
          ? 'EXC-002'
          : ruleId === 'CONV-004'
          ? 'EXC-005'
          : null;
      if (linkedExcId) {
        setExceptions((prev) =>
          prev.map((e) =>
            e.id === linkedExcId ? { ...e, status: 'Resolved (Buyer Verified)' } : e
          )
        );
      }

      showToast(
        `Verified Standardisation Rule ${ruleId}. Affected items (${rule.affectedItemIds.length}) unblocked in Bid Matrix.`,
        'success'
      );
    }
  };

  // Export matrix to CSV helper
  const handleExportMatrixCsv = () => {
    const headers = [
      'Item ID',
      'SKU Code',
      'Description',
      'Category',
      'Quantity',
      'UOM',
      'Baseline INR',
      'Apex Packaging INR',
      'Global Corrugators INR',
      'PrimePack Solutions INR',
      'Southern Box Mfg (Disq) INR',
      'EcoWrap Packaging INR',
    ];
    const rows = lineItems.map((item) => {
      const getVal = (vId: string) => {
        const c = quoteCells.find(
          (cell) => cell.itemId === item.id && cell.vendorId === vId
        );
        if (!c || !c.quoted) return 'No Quote';
        return (c.normalisedUnitPriceInr ?? c.provisionalUnitPriceInr ?? '').toString();
      };
      return [
        item.id,
        item.code,
        `"${item.description.replace(/"/g, '""')}"`,
        `"${item.category}"`,
        item.quantity,
        item.standardUom,
        item.baselineUnitPriceInr,
        getVal('V-APEX'),
        getVal('V-GLOBAL'),
        getVal('V-PRIMEPACK'),
        getVal('V-SOUTHERN'),
        getVal('V-ECOWRAP'),
      ].join(',');
    });
    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Hyderabad_Packaging_2026_Bid_Comparison.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Exported 30×5 Bid Comparison Matrix to Excel-compatible CSV.', 'success');
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
                setVendors(INITIAL_VENDORS);
                setQuoteCells(INITIAL_QUOTE_CELLS);
                setExceptions(INITIAL_EXCEPTIONS);
                setConversionRules(INITIAL_CONVERSION_RULES);
                setAwardApprovedByBuyer(false);
                showToast(
                  'Reset all 5 vendor submissions to initial Unextracted demo state.',
                  'info'
                );
              }}
              onFastForwardExtractedDemoState={handleExtractAllVendors}
              onNotify={showToast}
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
        isVendorQualityQualified={drawerVendorQual}
        onVerifyCell={handleVerifyCell}
        onRequestClarification={(vendorId, itemId, note) => {
          handleRequestVendorClarification(vendorId, `[${itemId}] ${note}`);
          setEvidenceTarget(null);
        }}
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
