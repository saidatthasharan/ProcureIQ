# ProcureIQ

AI-assisted quotation intelligence prototype for procurement (Aerchain product assignment).
Principle: **AI understands. Application code calculates. The buyer decides.**

## What it does
Reads supplier quotations (Excel, PDF, Word, photo, email), extracts structured quotes with source evidence, normalises prices in code (units, currency, GST, discount, freight), applies a mandatory-question gate, and lets a buyer question the data and compare award scenarios. An RFx copilot proposes changes that the buyer applies.

## Run it
1. `bun install` (npm may fail on a peer-dependency conflict)
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (server-side only; never sent to the browser)
3. `npm run dev`, then open the printed address
4. `npm test` runs the automated tests; `npm run eval:live` (needs a key) measures extraction against the generated sample files

Without a key, AI features return a clear error and show no data.

## Honest status
See `docs/PHASE2_STATUS.md`. In short: sample data is synthetic; tests of AI paths use a stand-in model; live Gemini accuracy is not yet measured; there is no login, database, persistent audit log, email sending or ERP integration.
