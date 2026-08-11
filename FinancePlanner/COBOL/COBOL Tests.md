---
type: test
domain: cobol
status: implemented
---

# COBOL Tests

- `server/test/cobol-engine.test.js` — exercises [[Transaction Rules Module]]/[[Finance Projection Module]] via [[cobol-engine.js]]
- `server/test/cobol-banking-core.test.js` — exercises [[Banking Core Module]] via [[cobol-banking-core.js]]
- **Local-sandbox result (2026-08-11, no GnuCOBOL runtime installed):** 4 failures, all `libcob.so.4` load errors — see [[COBOL Sandbox Limitation]]
- **CI result (same HEAD, fresh):** `cobol` job passes — full toolchain installed

Related: [[COBOL Index]] · [[COBOL CI Compilation]] · [[Testing and CI Index]]
