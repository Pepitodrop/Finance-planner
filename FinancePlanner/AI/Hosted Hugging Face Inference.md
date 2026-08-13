---
type: provider
domain: ai
status: unverified
---

# Hosted Hugging Face Inference

The one AI capability that is provider-dependent and leaves the device.

- **Client:** [[huggingFaceClient.js]] · **Router:** [[ai-router.js]]
- **Model:** [[Model Qwen3-4B-Thinking (hosted)]]
- **Configuration:** `HF_TOKEN` (server-only)
- **CI evidence:** `hosted-ai-acceptance.yml` (PR + manual dispatch), `runtime-canaries.yml` (weekly, skips without `HF_TOKEN`)
- **Default state:** `server/src/ai-capabilities.js` models "not verified" as the *default* — `liveVerification` reads `env.HF_LIVE_VERIFIED_AT`, defaulting to `{ verified: false, reason: 'live_acceptance_not_recorded' }`
- **Verification state:** implemented / **not runtime or production verified** — see [[Inference Verification Status]]

Related: [[AI Index]] · [[Provider Status]] · [[Model Qwen3-4B-Thinking (hosted)]]
