# PostgreSQL persistence

Finance Planner uses PostgreSQL for connector credentials, OAuth nonces, and webhook leases in the Compose deployment. Sensitive connector payloads remain encrypted by the application with `CONNECTOR_MASTER_KEY` before they are written to PostgreSQL.

## Configuration

The connector selects its persistence driver with `CONNECTOR_STORE_DRIVER`:

- `postgres` requires `DATABASE_URL` and is the production/Compose default.
- `file` retains the legacy encrypted file store for local development and controlled rollback only.

Example external database configuration:

```env
CONNECTOR_STORE_DRIVER=postgres
DATABASE_URL=postgresql://finance_planner:<password>@db.example.internal:5432/finance_planner?sslmode=require
DATABASE_POOL_SIZE=10
```

Keep the database private, require encrypted transport outside a trusted local container network, and use a dedicated least-privilege role. The database password and `CONNECTOR_MASTER_KEY` are separate secrets and must be backed up separately.

## Migrations

The connector applies pending migrations before it becomes ready. Migrations are ordered by their numeric filename prefix and serialized with a PostgreSQL advisory lock.

Run migrations independently before a release:

```bash
cd server
DATABASE_URL='postgresql://...' npm run migrate
```

Release procedure:

1. Back up PostgreSQL and verify that the backup is readable.
2. Record the currently deployed application commit and migration versions.
3. Run `npm run migrate` with the release artifact.
4. Verify the `schema_migrations` table and connector readiness endpoint.
5. Deploy the connector and run provider smoke tests.

Migrations must be additive and backward-compatible for at least one application version. Destructive schema changes require a separate expand/migrate/contract sequence and a tested rollback plan.

## Cutover from the encrypted file store

This PR establishes the PostgreSQL runtime and schema. It does not silently import the legacy encrypted file because an automatic import could duplicate or overwrite active provider credentials.

For an existing deployment:

1. Stop connector writes and create a verified copy of `connectors.enc.json`, its `.bak`, and the current `CONNECTOR_MASTER_KEY`.
2. Provision PostgreSQL and run migrations.
3. Export each legacy connection through a reviewed one-time migration utility or reconnect providers through the application.
4. Compare connection counts and complete a provider synchronization smoke test.
5. Set `CONNECTOR_STORE_DRIVER=postgres` and deploy.
6. Retain the encrypted legacy backup for the approved rollback window, then destroy it according to the retention policy.

Until a dedicated import utility is reviewed, reconnecting providers is the safer supported cutover path.

## Backup

For the Compose database:

```bash
mkdir -p backups
chmod 700 backups
docker compose exec -T postgres \
  pg_dump --format=custom --no-owner --no-acl \
  --username "${POSTGRES_USER:-finance_planner}" \
  "${POSTGRES_DB:-finance_planner}" \
  > "backups/finance-planner-$(date -u +%Y%m%dT%H%M%SZ).dump"
sha256sum backups/*.dump > backups/SHA256SUMS
chmod 600 backups/*
```

Use managed snapshots and point-in-time recovery where available. Store database backups, checksums, database credentials, and `CONNECTOR_MASTER_KEY` under separate access controls.

## Restore drill

Restore only into an empty disposable database first:

```bash
createdb finance_planner_restore_test
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname finance_planner_restore_test backups/<archive>.dump
psql finance_planner_restore_test -c 'TABLE schema_migrations;'
```

Then start a connector against the restored database using a copy of the matching `CONNECTOR_MASTER_KEY`, verify readiness, decrypt representative records, and perform provider smoke tests. A production restore requires a maintenance window, explicit approval, and documented RPO/RTO evidence.

## Rollback

Application rollback is safe only while the previous release understands every applied migration. Because migrations are forward-only, do not delete migration rows or manually reverse schema changes in production.

If a release fails after an additive migration:

1. stop the failed connector version;
2. deploy the previously recorded application artifact;
3. keep the migrated database schema in place;
4. verify readiness and provider synchronization;
5. restore the database only when data corruption is confirmed and the incident commander approves the recovery point.
