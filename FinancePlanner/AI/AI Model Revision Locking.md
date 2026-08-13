---
type: security
domain: ai
status: implemented
---

# AI Model Revision Locking

The hosted model is pinned to an immutable 40-hex-char revision hash, matching across `ai/model-lock.json`, `compose.yaml`, and `HF_MODEL_REVISION` — not a mutable tag like `:latest` or `:fastest` at the infrastructure-pin level (the client-facing default string is `:fastest`, but production configuration requires an actual pinned revision).

- **CI enforcement:** `verify-ai-model-lock.mjs`, part of the `npm test` chain

Related: [[AI Index]] · [[AI Model Allowlist]] · [[Model Qwen3-4B-Thinking (hosted)]]
