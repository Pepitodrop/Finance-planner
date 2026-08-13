---
type: ci
domain: cobol
status: implemented
---

# COBOL CI Compilation

`.github/workflows/ci.yml`'s `cobol` job installs GnuCOBOL and compiles the `.cob` sources into the binaries the connector needs at runtime.

- **Fresh evidence (2026-08-11, `/ship`):** `cobol` check re-confirmed **SUCCESS** (27s) at PR #131's final HEAD via live `gh pr checks` polling, not inferred from a prior phase.

Related: [[COBOL Index]] · [[Testing and CI Index]] · [[COBOL Failure Behavior]]
