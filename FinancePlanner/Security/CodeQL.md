---
type: ci
domain: security
status: implemented
---

# CodeQL (findings)

- **Alert #1** (`js/insufficient-password-hash`, `server/src/auth-store.js:10`): confirmed **false positive**, dismissed 2026-08-10 after live dataflow inspection — all 5 reported source-to-sink paths trace to hardcoded test-fixture constants, not the real `AUTH_MASTER_KEY` production path. Dismissal holds, re-confirmed fresh 2026-08-11.
- **19 other open alerts** (re-counted fresh during `/ship`, 2026-08-11 — corrects an earlier report's "28"): all confirmed pre-existing, and — for the 3 that share a filename with this PR's diff — confirmed outside the actual changed line ranges via direct line-number comparison, not just filename overlap.

Related: [[Security Index]] · [[CodeQL (technology)]] · [[Security Decisions]] · [[Known Issues and Limitations]]
