# ProcureIQ — Enterprise Procurement Intelligence Platform

ProcureIQ is an interactive enterprise SaaS platform built for procurement directors and strategic sourcing teams to automate, audit, and govern the end-to-end source-to-award lifecycle—from conversational RFx creation across 30 technical line items to multi-format vendor document extraction, unit/currency normalisation, side-by-side bid comparison, scenario simulation, and evidence-backed award recommendations.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and workflow decisions incorporate your confirmed Phase 1 choices to ensure an authentic, step-by-step live product demonstration without fabricating live AI execution claims.

- **Confirmed Decision 1 — Live Step-by-Step Extraction State**: All 5 vendor submissions load initially in an **Unextracted (`Pending Processing`)** state in the Vendor Response Inbox, allowing the presenter or evaluator to trigger extraction individually or in batch, observe real-time extraction confidence & exception discovery, and walk through manual verification step by step. (A convenient *"Fast-Forward Demo State"* action is also available in the top project bar for evaluators jumping directly to downstream comparison or simulation screens.)
- **Confirmed Decision 2 — Deterministic Dataset-Driven Simulation (`Demo Mode`)**: Both the **AI RFx Copilot** and **AI Procurement Analyst** operate on deterministic, auditable dataset-driven simulation clearly badged as `Demo Simulation Mode`, while exposing clean TypeScript service interfaces ready for live LLM integration in Phase 2.
- **Confirmed Decision 3 — Interactive Report Previews & Client-Side Exports**: The **Reports & Exports** workspace provides live interactive in-app report previews alongside real client-side `.csv` (Excel-compatible UTF-8 BOM) and structured `.json` downloads, plus print-formatted executive views.

---

## 1. Overview & Core Concept

- **What It Does**: Demonstrates the complete enterprise sourcing workflow for **Hyderabad Packaging Procurement – 2026** (Corrugated Packaging category, Hyderabad plant, INR baseline, 30 line items, 5 invited suppliers). Buyers author the RFx via an AI Copilot, ingest heterogeneous vendor bids (Excel, PDF with footnote discount, Word prose, angled camera photo of rate card, and incomplete email referencing historical pricing), resolve extraction & unit/currency exceptions, evaluate mandatory quality questionnaires, simulate split vs. single-vendor awards, and generate a fully auditable VP Award Recommendation.
- **Target Audience / Persona**: VP of Procurement, Category Managers, and Strategic Sourcing Analysts evaluating enterprise AI sourcing automation (AERCHAIN take-home demonstration).
- **Key Value**: Bridges the gap between unstructured supplier submissions and audit-ready commercial decisions—ensuring **buyer trust and governance** through cell/page-level source attribution, explicit conversion math, and hard quality-gate enforcement.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Executive Overview & Triage (`Overview`)**: View live KPIs derived dynamically from the 30-item dataset and current extraction progress. Clicking any KPI navigates directly to the corresponding filtered workspace.
2. **Conversational RFx Authoring (`RFx Workspace`)**: Prompt the AI RFx Copilot to generate scope, 30 corrugated packaging line items with technical specs (Bursting Strength, GSM, Flute Type, ECT, Moisture Tolerance), commercial terms (45-day payment, 15-day delivery), and a 12-point vendor qualification questionnaire. Distinguish `AI-Generated Draft` sections from `Buyer-Approved` items, edit specs inline, and invite the 5 suppliers.
3. **Multi-Format Ingestion (`Vendor Responses`)**: Inspect the 5 incoming vendor submissions in their initial unextracted state:
   - **Apex Packaging Industries** (`.xlsx` — 30 items, altered column headers & UOM variations)
   - **Global Corrugators Ltd.** (`.pdf` — 30 items, 4.5% volume discount hidden in page 3 footnote, USD pricing on export-grade items)
   - **PrimePack Solutions** (`.docx` — 28 items, commercial rates embedded in narrative paragraphs, freight extra)
   - **Southern Box Manufacturing** (`.jpg` — 30 items, angled smartphone photo of printed rate card requiring OCR & low-confidence manual verification, failed mandatory ISO/bursting test qualification)
   - **EcoWrap Packaging** (`.eml` — 22 items quoted, ambiguous "same as 2025 Q3 contract rate" references, missing 8 items)
4. **Source-to-Field Verification (`Document Intelligence` & `Standardisation Engine`)**: Side-by-side split view showing a realistic visual rendering of the original vendor document (spreadsheet grid, PDF page with footnote highlight, Word prose, angled rate-card photo with OCR bounding boxes, email thread) paired with extracted line items, cell/page references, confidence scores, exception severity queue (`Critical`, `Warning`, `Info`), and explicit unit/currency normalisation rules (`Per 100 pcs → Per Box`, `Per Tonne → Per Kg`, `USD → INR @ 83.50`, `Footnote Discount -4.5%`, `Freight +3.2%`, `GST 18% normalisation`).
5. **Side-by-Side Commercial Evaluation (`Bid Comparison` & `Vendor Questionnaire` tab/drawer)**: High-density 30-row × 5-vendor matrix with live filters (category, vendor, quality eligibility, missing quotes, unresolved exceptions), sorting, and cell click-through to source evidence. Includes full 12-question qualification matrix where **Southern Box Manufacturing** is flagged as `Quality Disqualified` due to failing mandatory bursting-strength & ISO 9001 criteria, blocking them from eligible lowest-bidder status.
6. **Natural Language Interrogation (`AI Procurement Analyst`)**: Interactive analyst workspace with the 10 pre-built strategic prompts and custom query support, returning structured tables, Recharts visualisations, explicit calculation breakdowns, source citations, and risk callouts.
7. **Interactive Award Modelling (`Scenario Simulator` & `Award Recommendations`)**: Real-time simulator allowing buyers to toggle allocation strategies (*Cheapest Quality-Qualified Split*, *Single-Vendor Consolidated Award*, *Fastest Lead-Time Priority*, *Custom Vendor Selection*), adjust USD/INR exchange rates, freight percentages, and mandatory quality gates, and promote the chosen scenario into a formal, evidence-backed **VP Award Recommendation** with executive sign-off controls.

### Visual Identity & Theme
- **Aesthetic Direction**: Utilitarian, high-trust enterprise SaaS inspired by Linear, Ramp, Coupa, and SAP Ariba. Clean architectural surfaces, single-elevation depth (`1px solid` hairline borders), zero decorative clutter, and unambiguous provenance indicators.
- **Color Palette & Mood**:
  - **Canvas & Surfaces (60% / 30%)**: Crisp Alabaster background (`#F8FAFC`), pure white structural work surfaces (`#FFFFFF`), slate hairline dividers (`#E2E8F0`), deep navy primary typography (`#0F172A`), and muted slate secondary prose (`#475569`).
  - **Primary Accent (10%)**: Enterprise Indigo (`#4F46E5` / `indigo-600`) reserved strictly for primary actions, active navigation states, and interactive focus rings.
  - **Semantic Governance Tokens**: Always paired with explicit text labels and icons:
    - Verified / Eligible: Emerald (`#15803D` text, `#F0FDF4` surface)
    - AI-Generated / Demo Simulation: Violet (`#6D28D9` text, `#F5F3FF` surface)
    - Pending Verification / Assumption / Warning: Amber (`#B45309` text, `#FFFBEB` surface)
    - Disqualified / Critical Exception / Blocked: Crimson (`#B91C1C` text, `#FEF2F2` surface)
- **Typography & Hierarchy**:
  - **Display & Navigation**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700) for crisp structural headings and workspace titles.
  - **Body & Controls**: `Public Sans` (Regular 400 / Medium 500) for dense enterprise scannability across questionnaires, specs, and audit notes.
  - **Data, Currency & Telemetry**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` enforced on all INR/USD prices, quantities, conversion factors, confidence percentages, and item IDs (`PKG-HYD-001` through `030`).
- **Interactive Feedback & Motion**:
  - Instant (<150ms) state transitions on filters, sorting, and scenario sliders.
  - Determinate multi-step document extraction progress simulation with toast confirmations and real-time badge updates across the sidebar.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unextracted Initial State with Guided Step-by-Step & One-Click Fast-Forward**
  - *Chosen Approach*: Start all 5 vendor responses in `Pending Extraction` so the user can experience clicking "Extract Information" in the Vendor Response Inbox and watching the Document Intelligence queue populate with realistic exceptions. Because downstream tabs (`Bid Comparison`, `Scenario Simulator`, `Award Recommendations`) depend on extracted data, those screens display a clear banner offering a single-click *"Process All 5 Vendor Documents Now"* action if visited before extraction is run.
  - *Why*: Respects the strict rule *"Do not mark documents as successfully extracted before processing has actually happened"* while guaranteeing zero friction if an evaluator jumps straight to the Bid Comparison Matrix.
- **Decision 2: Strict Separation of Hard Quality Disqualification vs. Soft Questionnaire Score**
  - *Chosen Approach*: The 12-question Vendor Questionnaire distinguishes **Mandatory Pass/Fail Gates** (ISO 9001:2015 certification, minimum 18 kg/cm² Bursting Strength lab test compliance, 45-day credit acceptance) from weighted commercial scoring. Even though **Southern Box Manufacturing** quotes the lowest raw price on several 3-ply and 5-ply cartons, their failure on mandatory bursting-strength testing automatically marks them `Quality Disqualified` and excludes their prices from "Lowest Eligible Price" calculations unless the buyer explicitly overrides the quality gate in the Scenario Simulator.
  - *Why*: Demonstrates enterprise governance where lowest price cannot override non-negotiable manufacturing quality standards.
- **Decision 3: Transparent Unit & Currency Normalisation Guardrails**
  - *Chosen Approach*: Every vendor quote stores both its `rawQuotedValue` + `rawUOM/Currency` and its `normalisedInrPerStandardUom` formula. Items with unverified ambiguous conversions (such as EcoWrap's unconfirmed 2025 historical reference or PrimePack's unverified roll-weight conversion factor) are flagged as `Requires Verification` and blocked from automatic award until the buyer verifies or resolves the conversion rule in the Standardisation Engine or Document Intelligence workspace.
  - *Why*: Enforces the core product principle: *"Never silently compare non-equivalent values."*

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                         ProcureIQ Application Shell                               │
│  ┌─────────────────────────┐  ┌────────────────────────────────────────────────┐  │
│  │ Persistent Left Sidebar │  │ Top Context Bar                                │  │
│  │  1. Overview            │  │  • Active Project: Hyderabad Packaging – 2026  │  │
│  │  2. RFx Workspace       │  │  • Global Search (Items, Vendors, Exceptions)  │  │
│  │  3. Vendor Responses    │  │  • Demo State Switcher (Unextracted / Ready)   │  │
│  │  4. Document Intel      │  │  • Notifications & Audit Log Drawer            │  │
│  │  5. Bid Comparison      │  └────────────────────────────────────────────────┘  │
│  │  6. AI Analyst          │  ┌────────────────────────────────────────────────┐  │
│  │  7. Scenario Simulator  │  │ Active Workspace Viewport                      │  │
│  │  8. Award Recommend.    │  │  • Shared Evidence Drawer (Source Doc + Math)  │  │
│  │  9. Reports & Exports   │  │  • Toast & Confirmation Modal Controller       │  │
│  │ 10. Settings            │  └────────────────────────────────────────────────┘  │
│  └─────────────────────────┘                                                      │
└─────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                   Central Procurement State & Business Logic Engine               │
│  ┌──────────────────────┐  ┌────────────────────────┐  ┌───────────────────────┐  │
│  │ RFx & 30 Line Items  │  │ Document Extraction &  │  │ Normalisation &       │  │
│  │ Store                │  │ Exception Queue Engine │  │ Qualification Engine  │  │
│  │ • Specs & Baseline   │  │ • 5 Multi-Format Docs  │  │ • UOM & FX Rules      │  │
│  │ • AI vs Buyer Status │  │ • Cell/Page Provenance │  │ • Mandatory Gates     │  │
│  └──────────────────────┘  └────────────────────────┘  └───────────────────────┘  │
│  ┌──────────────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │ Bid Matrix & Scenario Calculation    │  │ AI Copilot & Analyst Interfaces   │  │
│  │ Engine                               │  │ • Deterministic Demo Engine       │  │
│  │ • Live Total / Split / Single Award  │  │ • Pluggable LLM Service Contract  │  │
│  └──────────────────────────────────────┘  └───────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State
- **RFx Project & 30 Line Items (`LineItem[]`)**: Complete dataset for *Hyderabad Packaging Procurement – 2026* spanning 8 corrugated packaging sub-categories (5-Ply Heavy Duty Export Master Cartons, 3-Ply E-Commerce Mailer Boxes, Die-Cut Electronics Trays, Heavy-Duty Pallet Edge Protectors, Corrugated Partition Grids, 2-Ply Kraft Cushioning Rolls, Moisture-Barrier Laminated Cartons, Custom Printed Retail Shippers). Each item includes `id` (`PKG-HYD-001`..`030`), `name`, `category`, `technicalSpec` (GSM, Flute, Burst Factor, ECT, Dimensions), `quantity`, `uom`, `targetDeliveryDays`, `qualityRequirement`, `baselineUnitPriceInr`, and `approvalStatus` (`ai_generated` | `buyer_approved`).
- **5 Vendors & Questionnaire (`Vendor[]`)**: Complete profiles, submission timestamps, document formats (`.xlsx`, `.pdf`, `.docx`, `.jpg`, `.eml`), processing state (`unextracted` | `processing` | `extracted` | `verified` | `rejected`), 12 questionnaire responses with documentary evidence links, weighted scores, and `mandatoryCriteriaPassed` boolean with explicit disqualification reasons.
- **150 Vendor Quotation Cells (`VendorQuoteCell[]`)**: Mapped across the 30 items × 5 vendors, tracking `rawPrice`, `rawCurrency`, `rawUom`, `discountPct`, `freightPct`, `gstIncluded`, `conversionRuleId`, `normalisedUnitPriceInr`, `confidenceScore`, `sourceReference` (e.g., `Sheet1!F14`, `Page 2, Table 1 + Page 3 Footnote *`, `Para 4, Line 2`, `OCR Region [x:142, y:310]`), `validationStatus` (`verified` | `low_confidence` | `missing` | `ambiguous_historical` | `unit_mismatch`), and `buyerVerified` flag.
- **Standardisation Rules (`ConversionRule[]`)**: Explicit audit records for UOM conversions (`100 Pieces → 1 Box`, `1 Metric Tonne → 1,000 Kg`, `1 Roll (50m) → Linear Meter`), currency conversion (`USD → INR`), footnote discount application, and freight/tax adjustments, each with verification toggles.

### Interactive Component & State Mapping
- **Overview Dashboard**: Computes all 10 KPIs dynamically from current state. Clicking any KPI card sets the target workspace and active filter (e.g., clicking *Missing Quotations* opens `Bid Comparison` filtered to `status = missing`; clicking *Extraction Confidence* opens `Document Intelligence` sorted by lowest confidence).
- **RFx Workspace**: Interactive Copilot prompt bar populates or updates line items and commercial terms; inline edit modals allow modifying technical specs or adding custom line items; *"Approve All AI Content"* transitions items from `AI-Generated` to `Buyer Verified`.
- **Vendor Response Inbox**: *"Extract Information"* triggers a realistic extraction workflow per document (or batch), populating extracted item counts, confidence scores, and exception counts. Supports uploading additional revision documents, requesting vendor clarifications via modal, or rejecting non-compliant submissions.
- **Document Intelligence & Standardisation Engine**: Selecting any of the 5 vendors renders a faithful interactive preview of their submitted file format on the left and the structured field/exception table on the right. Buyers can resolve conflicting values, verify OCR readings on Southern Box's angled photo, reject EcoWrap's ambiguous 2025 pricing reference, and approve unit/currency conversion rules—immediately updating the Bid Comparison Matrix.
- **Bid Comparison Matrix**: Full 30×5 comparison grid plus embedded *Standardisation Engine* and *Vendor Questionnaire* sub-views. Clicking any cell opens the **Source Evidence Drawer** displaying the exact document snippet, conversion formula, confidence score, and a *"Mark Buyer Verified"* button.
- **Scenario Simulator & Award Recommendation**: Changing strategy presets, toggling vendor inclusion, or adjusting FX/freight sliders recalculates total spend, baseline savings, vendor split shares, and risk counters in real time. Clicking *"Promote Scenario to Award Recommendation"* populates the executive sign-off package in `Award Recommendations`.
- **Reports & Exports & Settings**: Generates live formatted previews and triggers browser file downloads (`.csv` and `.json`) for all 6 required enterprise reports, while `Settings` allows configuring mandatory quality thresholds, confidence auto-approval thresholds, baseline exchange rates, and viewing the LLM integration contract status.
