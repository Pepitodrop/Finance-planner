---
type: file
domain: cobol
status: implemented
---

# transaction_rules.cob

- **Program-ID:** `TRANSACTION-RULES`
- **Responsibilities:** [[Transaction Normalization]] (signed-amount → income/expense + absolute cents), [[Balance Normalization]] (apply a transaction to a balance), rejects unsupported operations
- **CLI contract:** `build/transaction-rules NORMALIZE -1299` → `OK|expense|1299`; `build/transaction-rules APPLY 100000 1299 expense` → `OK|98701`
- **Node caller:** [[cobol-engine.js]]
- **Tests:** `server/test/cobol-engine.test.js`

Related: [[COBOL Index]] · [[Node-COBOL Boundary]] · [[Goals Page]]
