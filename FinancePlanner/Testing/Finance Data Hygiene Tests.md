---
type: testing
domain: data
status: implemented
---

# Finance Data Hygiene Tests

Regression coverage added for the empty-production/test-seeding split:

- `src/data.test.ts` — production defaults remain empty and are not acceptance fixture data.
- `server/test/empty-production-data-boundary.test.js` — removed starter values cannot reappear in `src/data.ts`; test-account provisioning cannot implicitly seed finance state.
- `server/test/seed-test-account.test.js` — the versioned GnuCOBOL line protocol maps to a valid finance payload and fails closed on malformed counts/types/amounts.
- `server/test/clear-finance-data.test.js` — optional PostgreSQL integration coverage proves finance/provider rows are removed while authentication/migration state survives.
- `src/AccountPage.test.tsx` — full logout flushes before session revocation, then discards decrypted local state only after successful server logout.

Related: [[Empty Production Data]] · [[Test Data Seeding]] · [[Logout]] · [[Data and Persistence]]
