---
type: file
domain: cobol
status: implemented
---

# cobol-engine.js

- **Owns:** subprocess bridge to [[Transaction Rules Module]]/[[Finance Projection Module]] (`build/transaction-rules`, 5s timeout)
- **Fail-closed:** throws `Authoritative COBOL finance engine unavailable` in production unless explicitly overridden for non-production — see [[COBOL Failure Behavior]]

Related: [[Implementation Index]] · [[Node-COBOL Boundary]] · [[COBOL Failure Behavior]]
