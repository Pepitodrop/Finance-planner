# Full database reset and demo seed

This workflow is intentionally destructive. It deletes every Finance Planner application record, including users, passkeys, finance vaults, bank and PayPal connections, OAuth nonces, webhook records and distributed rate-limit data. It preserves only `schema_migrations` so the deployed schema version remains known.

The command cannot run accidentally:

- a PostgreSQL custom-format backup is mandatory;
- `pg_restore --list` must validate the archive;
- the archive is restored into a temporary database before deletion starts;
- the restored migration history and critical application tables must be present;
- the temporary restore database is removed after verification;
- `RESET_CONFIRM` must exactly equal `RESET_ALL_FINANCE_PLANNER_DATA`;
- `DATABASE_URL`, `CONNECTOR_MASTER_KEY` and `AUTH_MASTER_KEY` are required;
- the expected `auth_store` and `user_finance_state` tables must exist;
- truncation and demo seeding run in one database transaction;
- the inserted finance vault is decrypted and validated before success is reported.

## Preview the seed

```bash
cd server
npm install
npm run database:reset-demo:dry-run
```

The dry run does not connect to PostgreSQL or read encryption keys. It prints the demo account email and generated record counts.

## Execute on the deployment host

Stop the web and connector processes first so no writes or sessions race with the reset. Keep PostgreSQL running.

```bash
cd /path/to/Finance-planner
set -a
. ./.env
set +a

cd server
export RESET_CONFIRM=RESET_ALL_FINANCE_PLANNER_DATA
export RESET_BACKUP_PATH="../backups/pre-demo-reset-$(date -u +%Y%m%dT%H%M%SZ).dump"
export DEMO_USER_EMAIL="your-google-account@example.com"
export DEMO_USER_NAME="Finance Planner Demo"
npm run database:reset-demo
```

`pg_dump` and `pg_restore` must be installed on the host and compatible with the PostgreSQL server version. The database role must be allowed to create and drop the temporary restore database. The generated backup is set to mode `0600`.

Restart the deployment only after the command prints a successful JSON summary.

```bash
cd ..
docker compose up -d
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/ready
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/healthz
```

## Signing into the demo account

Set `DEMO_USER_EMAIL` to an email address you can use with the configured Google authentication. The seed creates the user as `demo-user`. On first Google login with the same normalized email address, Finance Planner reuses that seeded user and updates its Google profile details instead of creating a second account.

The initial account has no passkeys. Add a passkey after the first Google login when required.

## Demo content

The deterministic seed includes:

- six accounts: checking, savings, investment, travel, cash and emergency savings;
- more than 300 transactions across 18 months;
- salary, freelance income, recurring bills, groceries, mobility, subscriptions, leisure, travel and investment activity;
- inferred account transfers represented by matching debit and credit entries;
- five savings goals with different progress levels and deadlines;
- category-learning rules, assistant memory, budget preferences and automatic recurring-analysis metadata.

## Verification

```bash
docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT user_id, version, updated_at FROM user_finance_state;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT id, updated_at FROM auth_store;"
```

The finance and authentication payloads remain application-encrypted. Transaction descriptions and profile data must not appear as plaintext in PostgreSQL.

## Automated validation

The backend test suite creates an isolated PostgreSQL database, applies all migrations, inserts pre-existing encrypted records, executes the real backup/restore/reset/seed path, and verifies:

- the backup is non-empty and restorable;
- `schema_migrations` survives;
- old users and finance records are removed;
- exactly one demo user remains;
- the auth store and finance vault decrypt correctly;
- the seeded account, transaction, goal and automatic-analysis counts are valid.

## Recovery

Do not overwrite or delete the mandatory pre-reset backup until the demo environment has been accepted. Restore into a disposable database first and follow the verified restore procedure in [`DATABASE.md`](DATABASE.md).
