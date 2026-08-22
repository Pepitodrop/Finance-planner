# Test account data

Finance Planner does **not** seed finance data during normal startup, registration, login, vault setup, migration, or deployment. A fresh account starts with empty `accounts`, `transactions`, and `goals` collections. Test data is an explicit operator action and is scoped to the deterministic test account only.

## Provision an empty test account

Configure the usual server database/encryption variables plus:

```bash
export TEST_ACCOUNT_EMAIL="demo@finance-planner.test"
export TEST_ACCOUNT_NAME="Finance Planner Test User"
```

Then run inside the connector image/environment:

```bash
npm run test-account:provision
```

This creates or updates the deterministic `test:*` authentication identity. It does **not** add accounts, transactions or goals unless a seed source is explicitly requested.

## Seed deterministic finance data with GnuCOBOL

The preferred deterministic seed source is `core/cobol/test_seed_generator.cob`. `Dockerfile.server` compiles it to `/app/build/test-seed`; Node remains responsible for authentication lookup, validation, encryption and PostgreSQL persistence.

```bash
npm run test-account:seed
```

The Node provisioning script executes the COBOL binary, parses its JSON output, validates it through the same `validateCloudPayload()` boundary used for cloud state, encrypts it with the account binding, and stores it only for the configured deterministic test account.

The fixture contains one EUR checking account and a small set of deterministic booked transactions. It is test data, not a product default and not a simulation of live provider verification.

`TEST_ACCOUNT_SEED_FILE=/path/to/payload.json npm run test-account:provision` remains available for an explicitly supplied validated fixture. File seeding and `--seed-cobol` are mutually exclusive.

## Clear test-account finance data while keeping login access

This is deliberately confirmation-gated:

```bash
export TEST_DATA_RESET_CONFIRM=CLEAR_TEST_ACCOUNT_FINANCE_DATA
npm run test-account:clear-data
```

The command resolves the configured deterministic `test:*` user and refuses any other account. It removes only that test user's local Finance Planner finance/provider state:

- `connector_connections`
- `oauth_nonces`
- `user_finance_state`
- `user_budget_learning_profiles`

The authentication account is preserved so the same test login can be reused with an empty vault/state.

### Provider-session limitation

The maintenance reset does **not** contact external providers and therefore does not claim to revoke provider-side sessions. Use the normal Connections **Disconnect** flow when provider-side consent/session revocation must be tested. The reset command exists to clean local sandbox/test state, not as a substitute for production disconnect semantics.

## Removed global demo reset

The former `database:reset-demo` workflow was intentionally removed. It globally truncated application tables and injected a large hardcoded demo dataset. That behavior conflicts with Finance Planner's empty-by-default production contract and is unnecessarily broad for ordinary testing.

For backups/restores of real deployments, follow `DATABASE.md`; do not use test-account tooling as a database recovery mechanism.
