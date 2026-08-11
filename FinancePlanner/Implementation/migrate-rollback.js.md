---
type: file
domain: data
status: implemented
---

# migrate-rollback.js

- **Owns:** CLI rollback (`node src/migrate-rollback.js <target-version>`) using `server/migrations/down/*.sql`; refuses a partial rollback if any down-file is missing — fail-closed

Related: [[Implementation Index]] · [[Migrations System]] · [[migrate.js]]
