---
type: component
domain: data
status: implemented
---

# Migrations System

- **Forward:** [[migrate.js]] — advisory-lock pattern, idempotent, `ON CONFLICT DO NOTHING` against [[schema_migrations (table)]]
- **Rollback:** [[migrate-rollback.js]] — CLI, rolls back every migration newer than a target version using `server/migrations/down/*.sql`; refuses a partial rollback if any down-file is missing (fail-closed, not best-effort). Added 2026-08-03 — before that, backup-restore was the only rollback story.
- **Current migrations:** `001_connector_store`, `005_request_rate_limits`, `006_cloud_user_data`, `007_budget_learning_profiles`, `008_session_revocations`

Related: [[Data Index]] · [[Deployment]] · [[Config and Restore Drill]]
