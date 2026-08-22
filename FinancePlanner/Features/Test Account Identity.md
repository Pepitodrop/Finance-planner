---
type: feature
domain: auth
status: preserved
---

# Test Account Identity

The configured test account is an authentication identity, not a bundled finance dataset. `create-test-account.mjs` creates/verifies the identity only. Financial seed data requires the separate GnuCOBOL-backed test seeding command.

This separation allows the test user to exist with a personalized name while its accounts, transactions and goals remain empty until deliberately seeded.

Related: [[Authentication]] · [[Test Data Seeding]] · [[Empty Production Data]]
