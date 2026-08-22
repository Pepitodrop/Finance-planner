---
type: feature
domain: data
status: implemented
verification: integration-test-conditional
---

# Finance Data Cleanup

`server/scripts/clear-finance-data.mjs` is the explicit destructive operator tool for returning all Finance Planner users to zero financial/provider state without deleting authentication identity.

It targets only financial/provider tables and requires the exact confirmation token `DELETE_ALL_FINANCE_DATA_KEEP_AUTH`. Dry-run mode reports the rows that would be deleted. `auth_store`, session revocations, distributed rate limits, and migration history are preserved.

A browser may still hold an encrypted offline vault. Clearing PostgreSQL does not and must not silently delete that device-local encrypted copy; operators must reset/remove stale local finance data as a separate deliberate action when performing a complete cleanup.

Related: [[Empty Production Data]] · [[Data and Persistence]] · [[Authentication]] · [[Logout]]
