---
type: database
domain: data
status: implemented
---

# user_finance_state (table)

- **Migration:** `006_cloud_user_data.sql`
- **Contains:** accounts, transactions, savings goals, behavior graph, assistant memory, secure client prefs — the encrypted finance-vault payload
- **Encryption:** [[AES-256-GCM]], `CONNECTOR_MASTER_KEY`, user ID as AAD
- **Store/repository:** [[user-state-store.js]]
- **API:** `GET/POST /api/finance/state` via [[finance-router.js]]
- **Concurrency:** [[Optimistic Concurrency Version Check]] — `SELECT ... FOR UPDATE` + `expectedVersion` compare-and-swap, HTTP 409 on mismatch
- **Ownership:** every query `WHERE user_id=$1`-scoped — see [[Cross-User Isolation]]
- **Deletion:** cascaded in [[Account Deletion Flow]]
- **Feature/flow:** every page under [[Pages Index]] that reads/writes finance data
- **Schema validation (`validateCloudPayload()` in `user-state-store.js`):** every object shape (`account`, `transaction`, `goal`, `subscription`, `creditCard`) is checked against a strict `exactKeys()` allow-list before encryption — a deliberate security boundary against arbitrary JSON injection into the encrypted blob, and against provider credentials/tokens leaking into cloud state. This is the layer the "rejects unknown fields" line in [[Data and Persistence]]'s API contract section refers to.
- **Stale-schema bug found live (2026-08-26, PR #154, sixth Mock ASPSP pass) and fixed same day:** `validateAccount()`'s allow-list (`id, name, type, balanceCents, currency`) had drifted behind the frontend `Account` domain type, which had gained `institutionId`/`externalId`/`lastSyncedAt`/`creditCard` for bank-connector imports (`src/connectors.ts`'s `buildSyncPreview()`). The very first provider-imported account reaching `/api/finance/state` was rejected at `externalId` with `POST /api/finance/state -> 400`, dropping the app into LOCAL MODE immediately after a successful bank sync — see [[Enable Banking]]'s sixth-pass entry for the full live evidence. A second, identical-class gap was found alongside it: `AppState.subscriptions` was already read/written by `google-subscription-data.js` on Google Subscriptions disconnect, but `payload.state`'s own allow-list never permitted the field — a previously-unreachable-due-to-rejection drift of the same kind. Fixed by extending the allow-lists and adding bounded/typed validators for the new fields (never by loosening `exactKeys()`, special-casing a provider, or accepting arbitrary fields). `src/validation.ts`'s frontend guards (`isAccount()`/`isAppState()`/`isSubscription()`) were made coherent with the same bounds so a state the frontend accepts is not predictably rejected here. **Status: code-fixed, test-verified only (32 new/updated tests, verified genuine via spot-revert; adversarially reviewed, no CRITICAL/HIGH/MEDIUM findings) — NOT yet live-verified**; the encrypted round trip, AAD user-binding, and [[Optimistic Concurrency Version Check]] logic were all confirmed untouched by this fix.

Related: [[Data Index]] · [[Data and Persistence]] · [[Vault Conflict Page]] · [[Enable Banking]] · [[Provider Status]]
