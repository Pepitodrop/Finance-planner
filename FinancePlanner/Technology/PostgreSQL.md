---
type: technology
domain: data
status: implemented
---

# PostgreSQL

- **Version:** `postgres:17-bookworm` (Compose)
- **Role:** canonical cross-device authenticated data store — see [[Architecture Decisions]] (decision record)
- **Tables:** see [[Data Index]] — 9 confirmed tables from `server/migrations/*.sql`
- **Migration tooling:** [[migrate.js]] (forward, advisory-lock, idempotent), [[migrate-rollback.js]] (fail-closed CLI rollback)
- **Concurrency control:** [[Optimistic Concurrency Version Check]] via `SELECT ... FOR UPDATE`
- **CI evidence:** `connector-server`, `config-and-restore-drill`, `containers` CI jobs exercise this against a real Postgres service container — all confirmed green at PR #131's final HEAD

Related: [[Technology Index]] · [[Data and Persistence]] · [[Data Index]]
