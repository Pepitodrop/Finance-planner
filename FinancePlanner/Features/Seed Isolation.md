---
type: feature
domain: data
status: implemented
---

# Seed Isolation

The test seed path is isolated by internal user-id prefix: the seeder refuses any account whose id does not begin with `test:`. This check is in addition to resolving the configured `TEST_ACCOUNT_EMAIL` through the encrypted authentication store.

Related: [[Test Data Seeding]] · [[Cross-User Isolation]]
