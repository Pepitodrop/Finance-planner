# Lightweight Hugging Face model suite

This change adds one active Hugging Face reasoning integration plus a governed catalog of optional candidate models. Model weights are not committed to the repository.

## Model status

| Capability | Model | Status | Execution policy |
|---|---|---|---|
| Financial reasoning | `Qwen/Qwen3-4B-Thinking-2507:fastest` | Integrated | Hosted and optional |
| Multilingual semantic search | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Catalog only | Requires a dedicated local worker |
| Receipt extraction | `microsoft/Florence-2-base` | Catalog only | Requires a dedicated local worker |
| Relationship prediction | `mgalkin/ultra_3g` | Catalog only, experimental | Requires an isolated graph worker |

The catalog-only entries are approved candidates, not active inference integrations. They must not be presented as available product features until a worker, pinned model revision, evaluation suite, resource budget, and failure policy are implemented.

Finance Planner intentionally does not include a speech-recognition model in this suite. Voice entry is out of scope for the current product.

“Free” means there is no proprietary model licence fee introduced by this repository. Hosted inference can still cost money, while local inference consumes deployment CPU, RAM, storage, and possibly GPU resources. Model licences and revisions must be reviewed and pinned before production activation.

## Evidence reconciliation and confidence

`POST /api/ai/financial-intelligence` never returns raw model output directly. After schema validation, every signal is reconciled against the verified aggregate snapshot supplied by the server-facing API contract.

The reconciliation policy:

- removes recurring-cost claims when verified recurring expenses are zero;
- removes goal-risk claims when no goals exist;
- normalizes cash-flow severity against verified free cash flow;
- caps anomaly confidence and prevents aggregate-only anomaly claims from being labelled critical;
- adds deterministic evidence fields derived from the accepted snapshot;
- caps overall and per-signal confidence according to transaction count and history depth;
- returns `confidenceDetails` so clients can explain model confidence, calibrated confidence, data quality, and the applicable policy;
- preserves deterministic fallback behavior whenever inference, parsing, validation, or reconciliation fails.

The response source is `hugging-face-reconciled` when model output passed validation and evidence reconciliation. `deterministic-fallback` means no model-generated financial claim was accepted.

## Behavior learning

`POST /api/ai/behavior-prediction` produces bounded patterns after explicit consent. The endpoint does not accept transaction history from the client. It requires a trusted server-side history loader scoped to the authenticated user; without one, it returns `503 behavior_history_unavailable`.

The learner accepts at most 5,000 structured events from that trusted source and estimates monthly income, expenses, free cash flow, recurring-cost share, category concentration, weekday behavior, and volatility.

Safety constraints:

- no raw descriptions, merchant names, account identifiers, or credentials;
- no client-supplied financial history;
- no future-dated events;
- no model training on shared user data;
- no persistence inside the learning module;
- predictions are advisory and approval-gated;
- a 120-day rolling window limits stale behavior;
- confidence is bounded and driven by sample size.

The graph model remains experimental. It should only be activated after a typed user-specific graph schema, offline evaluation, deletion/export handling, drift monitoring, and a deterministic fallback are implemented.

## API

- `GET /api/ai/models` returns the governed catalog and each model's integration status.
- `POST /api/ai/behavior-prediction` uses trusted server-side history when configured.
- `POST /api/ai/financial-intelligence` provides guarded, evidence-reconciled language-model explanations.
