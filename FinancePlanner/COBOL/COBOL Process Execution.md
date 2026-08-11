---
type: component
domain: cobol
status: implemented
---

# COBOL Process Execution

Each COBOL call is a fresh subprocess invocation of a compiled native binary (`build/transaction-rules`, `/app/cobol/banking-core`), not a long-lived server or FFI binding. Bounded by timeouts (5s / 2s) and, for the banking core, a 16KB max buffer.

Related: [[COBOL Index]] · [[Node-COBOL Boundary]] · [[COBOL Failure Behavior]]
