---
type: model
domain: ai
status: unverified
---

# Model: Qwen3-4B-Thinking (hosted)

- **Model ID:** `Qwen/Qwen3-4B-Thinking-2507:fastest` (default), pinned to an immutable 40-hex-char revision matching `ai/model-lock.json`/`compose.yaml`
- **Task:** financial reasoning (Finance Assistant hosted path) · **Provider:** [[Hosted Hugging Face Inference]]
- **Runtime:** hosted — the only model that leaves the device
- **Input:** aggregated [[AI Financial Snapshot]] only — no raw descriptions/account names/transaction IDs/credentials
- **Output:** validated against [[AI Response Schema]]; malformed/unavailable output triggers deterministic fallback
- **Consent requirement:** explicit, per-request (`consentExternalAi === true`), enforced client- and server-side — see [[AI Consent Gate]]
- **Implementation:** [[huggingFaceClient.js]], [[ai-router.js]]
- **Configuration:** `HF_TOKEN` (server-only, never exposed to Vite/client bundles)
- **Verification state:** implemented / **runtime verified only when credentials are configured and the workflow is manually dispatched with `require_live_ai=true`**; ordinary PR runs do not require a real successful call. A recorded GitHub Actions run (`hosted-ai-acceptance`, run #81) shows `status: blocked_by_credentials` — evidence the acceptance **gate** ran, not that inference succeeded. **Not production-verified.**

Related: [[AI Index]] · [[Hosted AI Request Flow]] · [[Provider Status]] · [[Model reasoning]]
