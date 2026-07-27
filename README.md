# Finance Planner

An offline-first personal finance dashboard implemented as an independent open-source application. Base44 is used only as a visual reference.

## Current MVP

- Responsive React and TypeScript dashboard
- Installable mobile PWA with safe-area support, offline status, controlled updates, and install UX
- Account, balance, income, and expense tracking
- Savings goals and recurring-payment overview
- Twelve-month deterministic projection
- Local browser persistence
- GnuCOBOL fixed-point projection module
- Free local Hugging Face AI through Transformers.js-compatible ONNX models

## Mobile application

The mobile release currently ships as an installable progressive web application. It includes:

- standalone portrait launch mode
- iOS and Android home-screen metadata
- display-cutout and safe-area handling
- minimum mobile touch targets and keyboard-safe form sizing
- offline-state feedback
- explicit service-worker update activation instead of silent mid-session replacement
- install prompting with a bounded dismissal period
- CI verification for mobile manifest, service-worker security exclusions, and mobile CSS invariants

Native App Store and Play Store packaging, signing, device-lab testing, push notifications, biometric vault unlock, and store review remain separate release milestones.

## AI architecture

### Semantic transaction intelligence

`Xenova/paraphrase-multilingual-MiniLM-L12-v2` provides multilingual semantic embeddings for transaction categorization, merchant normalization support, similarity analysis, and explainable confidence scores.

### Behavior learning graph

Every manually entered classification and every accepted AI recommendation strengthens a local merchant-category relationship. The personal graph stores merchant and category nodes, weighted relationships, confirmation counts, and recurring-payment votes. Future recommendations prefer the user's confirmed behavior over generic model output.

The behavior graph remains in local browser storage and does not require a hosted Graph ML API.

### Adaptive finance assistant

The assistant now uses an adaptive free local model stack:

1. `onnx-community/Qwen2.5-0.5B-Instruct` is the primary instruction model. It runs quantized in the browser and uses WebGPU when supported.
2. `Xenova/flan-t5-small` is the low-resource fallback when the larger model or WebGPU path cannot load.
3. Deterministic exact-answer routing handles balances, recurring costs, cash flow, and largest expenses without asking a language model to calculate money.
4. A small local conversation memory keeps the latest assistant interactions and includes relevant history in later analysis and planning.

The assistant supports:

- personal finance analysis
- natural-language questions about stored financial data
- goal-based savings and cash-flow plans
- prioritized next steps with explicit assumptions
- persistent local conversational context

The assistant receives a compact local financial context. It does not directly modify balances, execute transactions, or replace deterministic calculations.

### Privacy and fallback

- no paid inference endpoint
- no Hugging Face token required
- transaction data is not sent to a hosted model API
- models are downloaded once and can be cached by the browser
- WebGPU acceleration is used when available, with CPU/WASM fallback
- deterministic rules remain available if a model cannot load
- authoritative money calculations use integer cents and deterministic logic

## Run locally

Requirements:

- Node.js 22+
- npm
- Optional: GnuCOBOL

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Compile the COBOL module:

```bash
cobc -m core/cobol/finance_projection.cob
```

## Production deployment

The container stack is a hardened single-host baseline. Before exposing it publicly, follow the mandatory configuration, backup, restore, monitoring, rollback, and incident-response requirements in [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

Security vulnerabilities should be reported privately as described in [`SECURITY.md`](SECURITY.md).

Quick local container start:

```bash
cp .env.example .env
# Replace both example secrets before continuing.
docker compose up --build -d
docker compose ps
```

Public deployments must use HTTPS, set `PUBLIC_DEPLOYMENT=true`, disable local authentication, keep the connector port private, and maintain tested backups.

## Architecture

```text
src/                    React/TypeScript application, mobile runtime, and local AI
public/                 PWA manifest, service worker, and install assets
server/                 Authentication, provider connectors, encrypted persistence, and COBOL API
core/cobol/             Deterministic fixed-point financial calculations
docs/                   Production operations guidance
.github/workflows/      CI for web, backend, containers, mobile invariants, and COBOL
```

## Next milestones

- shared transactional database with versioned migrations
- CSV and bank-statement import
- stronger periodicity detection using transaction dates and amount tolerances
- editable behavior-learning rules and graph inspection
- evaluation dataset for German banking descriptions
- receipt, invoice, and contract document extraction
- signed native Android and iOS packaging
- physical-device and accessibility test matrix
- managed monitoring, SLOs, paging, and disaster-recovery exercises
- formal threat model and penetration test

## Security

This is an early-stage application and has not undergone a formal security review. Do not use it as the sole record of important financial information. Generated analysis and plans are advisory, may be incomplete, and are not professional financial advice.

## License

No license has been selected yet. Until a license is added, all rights are reserved by the repository owner.
