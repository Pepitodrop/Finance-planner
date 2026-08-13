---
type: issue
domain: ai
status: unverified
---

# Inference Provider Status

CI-gate execution is never equated with successful provider inference anywhere in this graph. The distinction that matters:

| Evidence | What it proves |
|---|---|
| `hosted-ai-acceptance.yml` runs and passes | the acceptance **gate** executed correctly (consent/allowlist checks work) |
| `status: blocked_by_credentials` in the recorded artifact | `HF_TOKEN` was absent in that run — inference was never attempted |
| A manual dispatch with `require_live_ai=true` and a real token | the only path that would constitute actual inference evidence — **not found in-repo as of PR #131** |

Related: [[AI Index]] · [[Hosted Hugging Face Inference]] · [[Inference Verification Status]] · [[Provider Status]]
