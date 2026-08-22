---
type: feature
domain: data
status: implemented
verification: local-code-only
---

# Test Data Seeding

Finance Planner production accounts have no bundled financial starter data. Test finance data is deliberately opt-in and restricted to the configured test identity.

## Boundary

`core/cobol/test-data-seed.cob` is the deterministic record generator. It emits a versioned line protocol containing accounts, transactions and goals using integer cents.

`server/scripts/seed-test-account.mjs` is orchestration only:

1. execute the compiled GnuCOBOL generator;
2. parse and validate every record;
3. validate the resulting payload through the same `validateCloudPayload()` boundary used by the API;
4. resolve `TEST_ACCOUNT_EMAIL` from the encrypted [[auth_store (table)]];
5. refuse to continue unless the internal user id begins with `test:`;
6. encrypt with the normal per-user server envelope and upsert only that user's `user_finance_state` row.

Test-account provisioning itself does not seed financial data. The old destructive hardcoded demo reset/seeder was removed.

## Operator commands

- `npm run test-account:provision` — identity only
- `npm run test-account:seed:dry-run` — parse/validate COBOL output without a DB write
- `npm run test-account:seed` — explicit test-account seed
- `npm run database:clear-finance:dry-run` — inspect finance/provider rows
- `npm run database:clear-finance` with the explicit confirmation token — clear finance/provider data while preserving authentication

The production container compiles the generator to `/app/build/test-data-seed`.

Related: [[Data and Persistence]] · [[COBOL Domain Core]] · [[Authentication]] · [[Bank Connections]]
