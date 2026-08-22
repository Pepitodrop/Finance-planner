# Test account data

Finance Planner does **not** seed finance data during normal startup, registration, login, vault setup, migration, or deployment. A fresh account starts with empty `accounts`, `transactions`, and `goals` collections. Test data is an explicit operator action and is scoped to the deterministic test account only.

## Configure the deterministic test account

The tooling requires a test email and display name:

```bash
export TEST_ACCOUNT_EMAIL="demo@finance-planner.test"
export TEST_ACCOUNT_NAME="Finance Planner Test User"
```

`server/src/test-account-provisioning.js` derives a deterministic `test:<hash>` user id from the normalized email and refuses to take over an existing non-test account using that address.

If the account must sign in through the normal email/password form, configure `TEST_ACCOUNT_PASSWORD_HASH` through the existing server-side test-password mechanism. The plaintext password is never stored by the provisioning or seed scripts.

## Local development

From `server/`, with PostgreSQL/encryption environment variables already configured:

```bash
npm run test-account:provision
```

This creates or updates the deterministic authentication identity and leaves finance data empty.

To add the deterministic GnuCOBOL fixture:

```bash
npm run test-account:seed
```

The command first compiles `core/cobol/test_seed_generator.cob` to `server/build/test-seed`, then runs the Node provisioning script with the seed explicitly enabled. GnuCOBOL (`cobc`) must therefore be installed locally.

## Deployed Docker environment

`Dockerfile.server` compiles the same generator to `/app/build/test-seed`. The hardened runtime image intentionally removes `npm`, so maintenance commands in the running connector use `node` directly rather than `npm run`.

With `TEST_ACCOUNT_EMAIL` already present in the deployment `.env`, provision an empty test account with:

```bash
docker compose --env-file .env exec -T \
  -e TEST_ACCOUNT_NAME="Finance Planner Test User" \
  connector node scripts/create-test-account.mjs
```

Seed the deterministic finance fixture with:

```bash
docker compose --env-file .env exec -T \
  -e TEST_ACCOUNT_NAME="Finance Planner Test User" \
  connector node scripts/create-test-account.mjs --seed-cobol
```

The Node script executes the compiled COBOL binary, parses its JSON output, validates it through the same `validateCloudPayload()` boundary used for cloud state, encrypts it with the authenticated-user binding, and stores it only for the deterministic test account.

The fixture contains one EUR checking account and five deterministic transactions. It is test data, not a product default and not evidence of live bank-provider verification.

An operator-supplied JSON fixture remains available for controlled tests:

```bash
TEST_ACCOUNT_SEED_FILE=/path/to/payload.json npm run test-account:provision
```

File seeding and `--seed-cobol` are mutually exclusive. The supplied JSON still passes through `validateCloudPayload()` before encryption/persistence.

## Clear test-account finance data while preserving login access

The reset is deliberately confirmation-gated and refuses any user whose id does not match the deterministic `test:*` identity for `TEST_ACCOUNT_EMAIL`.

Local development:

```bash
export TEST_DATA_RESET_CONFIRM=CLEAR_TEST_ACCOUNT_FINANCE_DATA
npm run test-account:clear-data
```

Deployed Docker environment:

```bash
docker compose --env-file .env exec -T \
  -e TEST_DATA_RESET_CONFIRM=CLEAR_TEST_ACCOUNT_FINANCE_DATA \
  connector node scripts/clear-test-account-data.mjs
```

The command removes only that test user's local Finance Planner finance/provider state:

- `connector_connections`
- `oauth_nonces`
- `user_finance_state`
- `user_budget_learning_profiles`

The authentication account is preserved so the same test login can be reused with empty finance state.

### Provider-session limitation

The maintenance reset does **not** contact external providers and therefore does not claim to revoke provider-side sessions. Use the normal Connections **Disconnect** flow when provider-side consent/session revocation must be tested. This reset exists to clean local sandbox/test state, not as a substitute for production disconnect semantics.

## Removed global demo reset

The former `database:reset-demo` workflow was intentionally removed. It globally truncated application tables and injected a large hardcoded demo dataset. That behavior conflicts with Finance Planner's empty-by-default production contract and is unnecessarily broad for ordinary testing.

For backups/restores of real deployments, follow `DATABASE.md`; do not use test-account tooling as a database recovery mechanism.
