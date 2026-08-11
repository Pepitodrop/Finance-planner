---
type: ci
domain: security
status: implemented
---

# Dependency Audit

`Dependency security audit` CI job (`npm audit --omit=dev` server-side; frontend `vitest`'s dev-only CVEs are explicitly excluded from the production-dependency scope). Re-confirmed **SUCCESS** at PR #131's final HEAD during `/ship` (2026-08-11, fresh `gh pr checks` run).

Related: [[Security Index]] · [[Testing and CI Index]] · [[Known Issues and Limitations]]
