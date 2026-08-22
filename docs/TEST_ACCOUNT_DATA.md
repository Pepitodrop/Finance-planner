# Test account data

Finance Planner does **not** create test users or seed finance data during normal startup, registration, login, vault setup, migration, or deployment. Test-account creation and test-data seeding are explicit operator actions.

Authentication/security/database orchestration stays in Node.js. GnuCOBOL is used only for deterministic test-finance payload generation; plaintext passwords, password hashes, provider tokens, bank credentials, and database credentials are never embedded in the COBOL programs.

## Two COBOL generators

`core/cobol/test_account_empty_generator.cob` emits the canonical empty test-finance payload:

```json
{
  "state": { "accounts": [], "transactions": [], "goals": [] },
  "secureData": { "testAccount": { "generator": "gnucobol", "mode": "empty", "version": 1 } }
}
```

`core/cobol/test_seed_generator.cob` emits a deterministic comprehensive UI/test fixture containing:

- 5 EUR accounts: checking, savings, cash, investment, and credit card;
- 111 transactions across January-August 2026;
- income and expenses;
- recurring salary, rent, utilities, subscription-like charges, fitness, and monthly savings transfers;
- matched transfer presentation records between checking and savings;
- groceries, dining, transport, leisure, insurance, travel, shopping, gifts, and investment activity;
- a credit-card liability balance;
- 5 savings goals at different progress levels and target dates.

This fixture is intentionally broad enough to exercise the Dashboard, Accounts, Transactions, Recurring Payments, Goals, category analysis, transfer presentation, AI transaction inputs, and credit-card liability UI. It does **not** fake provider-dependent behavior: live bank/PayPal/Google connections, provider subscriptions, OAuth/PSD2 consent, sync, disconnect, and revocation still require their real sandbox/runtime flows.

## Configure the deterministic test identity

The Node provisioning boundary reads the test identity from server-side configuration:

```bash
export TEST_ACCOUNT_EMAIL="<configured test email>"
export TEST_ACCOUNT_NAME="Finance Planner Test User"
```

`server/src/test-account-provisioning.js` derives a deterministic `test:<hash>` user id from the normalized email and refuses to take over an existing non-test account using that address.

If the account signs in through the normal email/password form, configure `TEST_ACCOUNT_PASSWORD_HASH` through the existing server-side test-password mechanism. The plaintext password is never stored by the provisioning or seed scripts and must not be committed to the repository.

## Empty test account

The explicit empty-account workflow is:

1. execute the compiled GnuCOBOL empty-state generator **before any auth/database mutation**;
2. validate the emitted JSON through `validateCloudPayload()`;
3. create/update the deterministic test auth identity in Node.js;
4. encrypt the empty payload with the user binding;
5. persist that encrypted empty state in PostgreSQL.

Local development, with GnuCOBOL installed:

```bash
npm --prefix server run test-account:create-empty
```

Deployed Docker environment, where the COBOL program is already compiled into the connector image:

```bash
docker compose --env-file .env exec -T \
  -e TEST_ACCOUNT_NAME="Finance Planner Test User" \
  connector node scripts/create-test-account.mjs --empty-cobol
```

Running this again deliberately returns the deterministic test account to an encrypted empty finance state while preserving its test login identity.

## Comprehensive seed

Local development:

```bash
npm --prefix server run test-account:seed
```

The local command compiles both COBOL generators and then runs the Node orchestrator.

Deployed Docker environment:

```bash
docker compose --env-file .env exec -T \
  -e TEST_ACCOUNT_NAME="Finance Planner Test User" \
  connector node scripts/create-test-account.mjs --seed-cobol
```

The seed command is safe to run when the test account does not exist. It loads the empty COBOL payload first, creates the deterministic test identity, persists the empty state as the bootstrap version, and only then applies the comprehensive COBOL seed. If the test account already exists, the comprehensive seed replaces that account's encrypted finance state without creating another identity.

The command reports whether the test account was newly created, whether an empty bootstrap was applied, and the final account/transaction/goal counts.

## Provision identity only

For maintenance cases that need only the deterministic authentication identity without touching its finance state:

```bash
npm --prefix server run test-account:provision
```

In the deployed connector:

```bash
docker compose --env-file .env exec -T \
  -e TEST_ACCOUNT_NAME="Finance Planner Test User" \
  connector node scripts/create-test-account.mjs
```

Prefer `--empty-cobol` when the objective is an explicitly empty test account.

## Operator-supplied seed file

A controlled JSON fixture remains supported through `TEST_ACCOUNT_SEED_FILE`. If the deterministic test identity does not yet exist, the same empty COBOL bootstrap runs first before the supplied validated payload is persisted.

`TEST_ACCOUNT_SEED_FILE` cannot be combined with `--seed-cobol` or `--empty-cobol`.

## Clear test-account finance data while preserving login access

The existing reset remains confirmation-gated and refuses any user whose id does not match the deterministic `test:*` identity for `TEST_ACCOUNT_EMAIL`.

Local development:

```bash
export TEST_DATA_RESET_CONFIRM=CLEAR_TEST_ACCOUNT_FINANCE_DATA
npm --prefix server run test-account:clear-data
```

Deployed Docker environment:

```bash
docker compose --env-file .env exec -T \
  -e TEST_DATA_RESET_CONFIRM=CLEAR_TEST_ACCOUNT_FINANCE_DATA \
  connector node scripts/clear-test-account-data.mjs
```

For `user_finance_state`, this reset writes a newly encrypted empty payload and increments the cloud-state version instead of deleting the row. That prevents a stale synced browser vault from treating a missing server row as an invitation to recreate old cloud data.

The command also clears the test user's local connector/setup/learning rows. It does **not** contact external providers and therefore does not claim to revoke provider-side sessions or consents.

## Factory reset versus test-account reset

`factory-reset` removes all Finance Planner user/application data and is intended only for an explicit full clean baseline. `test-account:create-empty` is much narrower: it creates or resets only the configured deterministic test account to zero finance data.

For backups/restores of real deployments, follow `DATABASE.md`; do not use test-account tooling as a database recovery mechanism.
