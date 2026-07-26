# Finance Planner

An offline-first personal finance dashboard implemented as an independent open-source application. Base44 is used only as a visual reference.

## Current MVP

- Responsive React and TypeScript dashboard
- Account, balance, income, and expense tracking
- Savings goals and recurring-payment overview
- Twelve-month deterministic projection
- Local browser persistence
- GnuCOBOL fixed-point projection module
- Free local Hugging Face AI through Transformers.js-compatible ONNX models

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

## Architecture

```text
src/                    React/TypeScript application and local AI
core/cobol/             Deterministic fixed-point financial calculations
.github/workflows/      CI for web and COBOL
```

## Next milestones

- encrypted SQLite storage
- CSV and bank-statement import
- stronger periodicity detection using transaction dates and amount tolerances
- editable behavior-learning rules and graph inspection
- evaluation dataset for German banking descriptions
- receipt, invoice, and contract document extraction
- Tauri desktop and mobile packaging
- COBOL C ABI bindings

## Security

This is an early MVP and has not undergone a formal security review. Do not use it as the sole record of important financial information. Generated analysis and plans are advisory, may be incomplete, and are not professional financial advice.

## License

No license has been selected yet. Until a license is added, all rights are reserved by the repository owner.
