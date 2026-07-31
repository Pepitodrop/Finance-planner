# PostgreSQL persistence

Finance Planner uses PostgreSQL as the canonical production store for authenticated user finance vaults, authentication profiles and passkeys, connector credentials, OAuth nonces, webhook leases, webhook idempotency and distributed rate limits.

Sensitive application documents are encrypted before they are written:

- finance vaults and provider credentials use `CONNECTOR_MASTER_KEY`;
- authentication profiles and passkeys use `AUTH_MASTER_KEY`, with a controlled legacy-key migration path from `CONNECTOR_MASTER_KEY`;
- browser copies remain separately encrypted with the device vault password.

## Stored data

| Table | Purpose |
|---|---|
| `user_finance_state` | versioned per-user accounts, transactions, savings goals, behavior graph, assistant memory and secure preferences |
| `auth_store` | encrypted Google user profiles, passkeys and temporary WebAuthn challenges |
| `connector_connections` | encrypted provider credentials and connection metadata |
| `oauth_nonces` | single-use provider authorization state |
| `webhook_events` | durable webhook leases and completion state |
| `rate_limit_windows` | distributed production rate limiting |
| `schema_migrations` | applied schema versions |

## Configuration

The connector selects its infrastructure persistence driver with `CONNECTOR_STORE_DRIVER`:

- `postgres` requires `DATABASE_URL` and is the production/Compose default;
- `file` is a local-development fallback for connector and auth storage only;
- cross-device finance synchronization is intentionally unavailable without PostgreSQL.

Example external database configuration:

```env
CONNECTOR_STORE_DRIVER=postgres
DATABASE_URL=postgresql://finance_planner:<password>@db.example.internal:5432/finance_planner?sslmode=require
DATABASE_POOL_SIZE=10
CONNECTOR_MASTER_KEY=<independent-high-entropy-secret>
AUTH_MASTER_KEY=<different-independent-high-entropy-secret>
```

Keep the database private, require encrypted transport outside a trusted local container network and use a dedicated least-privilege role. Database credentials and application encryption keys are separate secrets and must be backed up under separate controls.

## Migrations

The connector applies pending migrations before it becomes ready. Migrations are ordered by numeric filename prefix and serialized with a PostgreSQL advisory lock.

Migration `006_cloud_user_data.sql` adds the authenticated finance-vault and auth-store tables.

Run migrations independently before a release:

```bash
cd server
DATABASE_URL='postgresql://...' npm run migrate
```

Release procedure:

1. Back up PostgreSQL and verify that the archive is readable.
2. Record the deployed application commit and migration versions.
3. Run `npm run migrate` with the release artifact.
4. Verify `schema_migrations`, `user_finance_state` and `auth_store`.
5. Deploy the connector and web application.
6. Run authentication, cross-device finance-state and provider smoke tests.

Migrations must be additive and backward-compatible for at least one application version. Destructive schema changes require an expand/migrate/contract sequence and tested rollback plan.

## Existing deployment migration

The first connector startup after this change performs safe migrations:

- the existing encrypted authentication file is imported into `auth_store` when the database row does not yet exist;
- if a new `AUTH_MASTER_KEY` is configured, the old file can still be decrypted with the legacy `CONNECTOR_MASTER_KEY` and is immediately re-encrypted with the dedicated auth key;
- the first successful vault unlock uploads the current browser finance vault into `user_finance_state` when no server document exists;
- existing PostgreSQL provider credentials remain in place.

Keep the old encrypted auth and browser backups until the database rows and cross-device test have been verified.

## Verification

```bash
set -a
. ./.env
set +a

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT user_id, version, updated_at FROM user_finance_state;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT id, updated_at FROM auth_store;"
```

Application-encrypted columns should contain envelopes and ciphertext, not readable transaction descriptions, account names or passkey data.

## Backup

For the Compose database:

```bash
mkdir -p backups
chmod 700 backups
BACKUP="backups/finance-planner-$(date -u +%Y%m%dT%H%M%SZ).dump"

docker compose exec -T postgres sh -lc \
  'pg_dump --format=custom --no-owner --no-acl --username "$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$BACKUP"

chmod 600 "$BACKUP"
sha256sum "$BACKUP" > "$BACKUP.sha256"
pg_restore --list "$BACKUP" >/dev/null
```

Use managed snapshots and point-in-time recovery where available. Store database backups, checksums and both application encryption keys under separate access controls.

## Restore drill

Restore only into an empty disposable database first:

```bash
set -a
. ./.env
set +a
RESTORE_DB=finance_planner_restore_test

docker compose exec -T postgres dropdb --if-exists -U "$POSTGRES_USER" "$RESTORE_DB"
docker compose exec -T postgres createdb -U "$POSTGRES_USER" "$RESTORE_DB"
cat "$BACKUP" | docker compose exec -T postgres \
  pg_restore --exit-on-error --no-owner --no-acl \
  -U "$POSTGRES_USER" -d "$RESTORE_DB"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$RESTORE_DB" \
  -c 'TABLE schema_migrations;'
```

Then start a disposable connector against the restored database with copies of the matching encryption keys. Verify readiness, authentication, decryption of representative finance documents and provider synchronization.

## Rollback

Application rollback is safe only while the previous release understands every applied migration. Migrations are forward-only; do not delete migration rows or manually reverse schema changes in production.

If a release fails after an additive migration:

1. stop the failed connector version;
2. deploy the previously recorded application artifact;
3. keep the additive schema in place;
4. verify readiness and existing provider synchronization;
5. restore the database only when corruption is confirmed and the approved recovery point is understood.

A rollback to a version that lacks cloud-state endpoints leaves the new encrypted rows untouched but temporarily disables cross-device synchronization.
