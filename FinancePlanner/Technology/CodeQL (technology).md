---
type: technology
domain: security
status: implemented
---

# CodeQL (technology)

- **Where used:** `security-analysis.yml`, and a native `CodeQL`/`CodeQL JavaScript analysis` PR check
- **State at PR #131's final HEAD** (re-checked fresh during `/ship`, 2026-08-11): 22 alerts ever created — 1 dismissed (alert #1, `js/insufficient-password-hash`, false positive — dataflow traced to test-fixture constants, not the real `AUTH_MASTER_KEY` path), 2 fixed, **19 open**, all pre-existing and confirmed outside this PR's actual diff hunks (line-number comparison, not just filename overlap)
- **Correction:** an earlier `/make-pdf` phase report cited 28 open alerts — the accurate fresh count is 19

Related: [[Technology Index]] · [[CodeQL]] · [[Security Decisions]]
