---
type: component
domain: cobol
status: implemented
---

# Node ↔ COBOL Boundary

Subprocess execution via `node:child_process.execFile`, not FFI/shared library.

- [[cobol-engine.js]] — 5s timeout, parses pipe-delimited `OK|...` result
- [[cobol-banking-core.js]] — 2s timeout, 16KB max buffer, checks binary existence before invoking
- **Contract:** Node never re-implements the math; it only marshals arguments and parses the deterministic text response

Related: [[COBOL Index]] · [[COBOL Process Execution]] · [[Backend]]
