---
type: test
domain: ai
status: unverified
---

# Hosted Inference Acceptance

`.github/workflows/hosted-ai-acceptance.yml` runs `scripts/live-ai-acceptance.mjs` on every PR + manual dispatch against `HF_TOKEN`. `require_live_ai` defaults `false`, only forced `true` on manual dispatch. Corresponds to CI check `hosted-inference` (6s at PR #131's HEAD — gate-execution speed, not inference latency).

- **Recorded evidence (run #81):** `status: blocked_by_credentials` — gate ran, inference did not

Related: [[Testing and CI Index]] · [[Hosted Hugging Face Inference]] · [[Inference Provider Status]]
