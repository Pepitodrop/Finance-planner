# Lightweight Hugging Face model suite

This change adds a governed catalog of optional Hugging Face models without committing model weights to the repository.

## Included model references

| Capability | Model | Default | Execution policy |
|---|---|---:|---|
| Financial reasoning | `Qwen/Qwen3-4B-Thinking-2507:fastest` | Yes | Hosted and optional |
| Multilingual semantic search | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | No | Optional local worker |
| Voice entry | `openai/whisper-tiny` | No | Optional local worker |
| Receipt extraction | `microsoft/Florence-2-base` | No | Optional local worker |
| Relationship prediction | `mgalkin/ultra_3g` | No | Experimental local worker |

“Free” means there is no proprietary model licence fee in this repository. Hosted inference can still cost money, while local inference consumes deployment CPU, RAM, storage, and possibly GPU resources. Model licences and revisions must be reviewed and pinned before production activation.

## Behavior learning

`POST /api/ai/behavior-prediction` learns bounded patterns from a maximum of 5,000 structured events after explicit consent. It estimates monthly income, expenses, free cash flow, recurring-cost share, category concentration, weekday behavior, and volatility.

The first implementation is deliberately lightweight and deterministic:

- no raw descriptions, merchant names, account identifiers, or credentials;
- no model training on shared user data;
- no persistence inside the learning module;
- predictions are advisory and approval-gated;
- a 120-day rolling window limits stale behavior;
- confidence is bounded and driven by sample size.

The graph model remains experimental. It should only be activated after a typed user-specific graph schema, offline evaluation, deletion/export handling, drift monitoring, and a deterministic fallback are implemented.

## API

- `GET /api/ai/models` returns the governed model catalog.
- `POST /api/ai/behavior-prediction` returns privacy-minimised learned predictions.
- `POST /api/ai/financial-intelligence` continues to provide guarded language-model explanations.
