---
type: database
domain: data
status: implemented
---

# schema_migrations (table)

- **Contains:** the record of applied migrations (idempotency ledger for [[migrate.js]])
- **Pattern:** advisory-lock + `ON CONFLICT DO NOTHING`, safe under concurrent connector startup
- **Rollback counterpart:** [[migrate-rollback.js]] uses matching `server/migrations/down/*.sql` files; refuses a partial rollback if any down-file is missing (fail-closed)

Related: [[Data Index]] · [[Migrations System]] · [[PostgreSQL]]
