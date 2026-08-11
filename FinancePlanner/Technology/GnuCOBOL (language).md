---
type: language
domain: cobol
status: implemented
---

# GnuCOBOL

- **Where used:** `core/cobol/*.cob` — compiled via `cobc` into native binaries invoked by the Node connector via `execFile`
- **Why:** exact, deterministic finance/banking-domain math, structurally separated from probabilistic AI (see [[Architecture Decisions]])
- **Subsystems depending on it:** [[COBOL Banking Domain]] entirely; [[Bank Connections]]; [[AI System]]'s deterministic boundary
- **Files:** [[COBOL Index]]
- **Tests:** [[COBOL Tests]]
- **CI:** `.github/workflows/ci.yml` installs GnuCOBOL and compiles the binaries — see [[COBOL CI Compilation]]

Related: [[Technology Index]] · [[COBOL Domain Core]] · [[COBOL Index]]
