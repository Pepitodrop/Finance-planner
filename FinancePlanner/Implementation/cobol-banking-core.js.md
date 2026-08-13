---
type: file
domain: cobol
status: implemented
---

# cobol-banking-core.js

- **Owns:** `CobolBankingCore` class — subprocess bridge to [[Banking Core Module]] (`/app/cobol/banking-core`, 2s timeout, 16KB max buffer)
- **Fail-closed:** throws `cobol_unavailable` when `COBOL_BANKING_REQUIRED=true` — provider-facing operations always hard-require the binary

Related: [[Implementation Index]] · [[Banking Core Module]] · [[Node-COBOL Boundary]]
