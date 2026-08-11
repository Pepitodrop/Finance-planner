---
type: issue
domain: ai
status: unverified
---

# Inference Verification Status

`server/src/ai-capabilities.js` defaults `liveVerification` to `{ verified: false, reason: 'live_acceptance_not_recorded' }` — unverified is the code's own default, not an omission in documentation. Only `HF_LIVE_VERIFIED_AT` being explicitly set would flip this, and no evidence of that was found in-repo.

Related: [[AI Index]] · [[Hosted Hugging Face Inference]] · [[Inference Provider Status]]
