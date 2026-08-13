---
type: security
domain: ai
status: implemented
---

# AI Data Minimization

Only an aggregated [[AI Financial Snapshot]] is ever sent to the hosted model — raw merchant descriptions, account names, transaction IDs, and credentials are explicitly excluded (`docs/HUGGINGFACE_AI.md`).

- **Enforced by:** the closed request-field allowlist in [[ai-router.js]] (same mechanism as [[AI Consent Gate]], different concern: *what* can be sent, not *whether* it can)
- **Local models never need this control:** [[Model semantic-multilingual]], [[Model reasoning]], [[Model receipt]], etc. never transmit data externally at all

Related: [[AI Index]] · [[AI Consent Gate]] · [[AI Financial Snapshot]]
