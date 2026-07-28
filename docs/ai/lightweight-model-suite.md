# Lightweight Hugging Face model suite

This change adds one active Hugging Face reasoning integration plus a governed catalog of optional candidate models. Model weights are not committed to the repository.

## Model status

| Capability | Model | Status | Execution policy |
|---|---|---|---|
| Financial reasoning | `Qwen/Qwen3-4B-Thinking-2507:fastest` | Integrated | Hosted and optional |
| Multilingual semantic search | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Catalog only | Requires a dedicated local worker |
| Voice entry | `openai/whisper-tiny` | Catalog only | Requires a dedicated local worker |
| Receipt extraction | `microsoft/Florence-2-base` | Catalog only | Requires a dedicated local worker |
| Relationship prediction | `mgalkin/ultra_3g` | Catalog only, experimental | Requires an isolated graph worker |

The catalog-only entries are approved candidates, not active inference integrations. They must not be presented as available product features until a worker, pinned model revision, evaluation suite, resource budget, and failure policy are implemented.

“Free” means there is no proprietary model licence fee introduced by this repository. Hosted inference can still cost money, while local inference consumes deployment CPU, RAM, storage, and possibly GPU resources. Model licences and revisions must be reviewed and pinned before production activation.

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
- `POST /api/ai/financial-intelligence` provides guarded language-model explanations.
