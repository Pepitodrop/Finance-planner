# AI System

## Local vs hosted split

- **Local (browser):** `src/aiModels.ts` registry, `loader: 'transformers-js'` entries dynamically import the vendored `/vendor/transformers-3.8.1.min.js`, served from the app origin (not a CDN) with strict JS/WASM MIME types for CSP compatibility. Includes `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (categorization embeddings), `onnx-community/Qwen2.5-0.5B-Instruct` (local assistant where supported), `Xenova/flan-t5-small` (lower-resource fallback).
- **Hosted (optional):** `server/src/huggingFaceClient.js` + `ai-router.js`, server-side only. Default model `Qwen/Qwen3-4B-Thinking-2507:fastest`, pinned to an immutable 40-hex-char revision matching `ai/model-lock.json` and `compose.yaml`. `HF_TOKEN` must never reach the client bundle (`docs/HUGGINGFACE_AI.md`).

## Deterministic/AI boundary

AI output is strictly advisory. Exact balances, totals, projections and mutations remain deterministic (COBOL core, see [[COBOL Domain Core]]) and never depend solely on generative output (`docs/AI_PRODUCTION.md`). Suggested actions are approval-gated — AI cannot execute payments or silently change balances.

## Consent / privacy boundary

`ai-router.js` throws `ai_consent_required` unless `consentExternalAi === true`, and rejects any request field outside a closed allowlist (`consentExternalAi`, `snapshot`, `intent`). A separate consent gate exists for behavior-learning requests; behavior history must be loaded server-side, never client-supplied. Only an aggregated `FinancialSnapshot` is sent to the hosted model — raw merchant descriptions, account names, transaction IDs, and credentials are excluded (`docs/HUGGINGFACE_AI.md`).

## Model governance

`server/src/ai-ensemble.js` maintains a frozen `REVIEWED_MODEL_REVISIONS` allowlist per role (analyst/critic); `reviewedModel()` throws for anything not on it — a hard runtime block, not just a doc convention.

## Evaluation / quality gates

`npm test` chains `verify-ai.mjs`, `verify-ai-evaluation.mjs`, `verify-ai-quality-gates.mjs`, `verify-ai-model-lock.mjs` — these run on every `npm test` invocation, and `.github/workflows/ci.yml` runs `npm test` on every PR/main. `docs/AI_EVALUATION.md`/`docs/AI_PRODUCTION.md` define numeric gates (macro F1 ≥0.85 categorization, merchant-normalization precision ≥0.90, 100% deterministic-monetary-answer match).

## Runtime verification of hosted inference

- `.github/workflows/hosted-ai-acceptance.yml` — runs `scripts/live-ai-acceptance.mjs` on every PR + manual dispatch against `HF_TOKEN`; `require_live_ai` (whether a real successful call is mandatory) defaults `false` and is only forced `true` on manual dispatch.
- `.github/workflows/runtime-canaries.yml` — weekly scheduled canary; writes a `"status":"skipped"` artifact if `HF_TOKEN` is absent, only fails the job if `REQUIRE_ALL=true`.
- `server/src/ai-capabilities.js` models "not verified" as the *default* state: `liveVerification` reads `env.HF_LIVE_VERIFIED_AT`, defaulting to `{ verified: false, reason: 'live_acceptance_not_recorded' }`.

Verification state: local vs hosted split, consent gating, model-lock allowlist, and CI-enforced evaluation gates — **implemented and CI-enforced**. Hosted HF live inference — **implemented / runtime verified only when credentials are configured and the workflow is manually dispatched with `require_live_ai=true`; ordinary PR runs do not require a real successful call by default.**

Related: [[COBOL Domain Core]], [[Security Decisions]], [[Provider Status]]
