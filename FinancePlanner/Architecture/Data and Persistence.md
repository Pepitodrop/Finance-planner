# Data and Persistence

## Canonical model

**PostgreSQL is the canonical authenticated user-data store.** The browser vault is an encrypted offline cache, never the only copy (`README.md`, `docs/CLOUD_DATA.md`).

| Data | Table | Encryption |
|---|---|---|
| Accounts, transactions, savings goals, behavior graph, assistant memory, secure client prefs | `user_finance_state` | AES-256-GCM, `CONNECTOR_MASTER_KEY`, user ID as AAD |
| Google profile, passkeys, WebAuthn challenges | `auth_store` | AES-256-GCM, `AUTH_MASTER_KEY` (legacy fallback to `CONNECTOR_MASTER_KEY`) |
| Bank/PayPal provider credentials | `connector_connections` | AES-256-GCM provider payload |
| OAuth state | `oauth_nonces` | single-use |
| Webhook leases/idempotency | `webhook_events` | — |
| Distributed rate limiting | `rate_limit_windows` | — |
| Applied migrations | `schema_migrations` | — |
| Browser copy | local vault (`src/vault.ts`) | PBKDF2-SHA-256 (310k iterations) + AES-256-GCM, device vault password, account-bound |

## Sync lifecycle (`docs/CLOUD_DATA.md`)

1. Authenticate (Google or passkey) → unlock/create local vault (per-device password).
2. `GET /api/finance/state` with session cookie. If a server doc exists it replaces the local cache (then re-encrypted with the device's local password); otherwise the local vault uploads as version 1.
3. Local edits debounce into `POST /api/finance/state`.
4. Every write carries `expectedVersion`. Server compares under a row lock (`SELECT ... FOR UPDATE` in `user-state-store.js`) and rejects with a version-conflict error (surfaced as HTTP 409 by `finance-router.js`) on mismatch — classic compare-and-swap, not last-write-wins.
5. A `dirty` flag + last-synced version persist locally so offline edits survive a browser restart.
6. True conflicts (both copies changed) surface an explicit UI (`src/VaultConflict.tsx`); neither side is silently overwritten.

## Offline behavior

When PostgreSQL/network is unavailable, the app keeps the encrypted local cache, shows a local/offline status, and retries with bounded exponential backoff — it does not discard local changes.

## Fresh-account state is genuinely empty (PR #131 fix)

`src/data.ts`'s `initialState` (used both as the default for a brand-new vault and as the "Clear financial data" target) is `emptyProductionState` — zero accounts/transactions/goals. It used to be a hardcoded German sample dataset (`Girokonto`/`Tagesgeld`/`Bargeld` accounts, `Notgroschen` goal, REWE/Minecraft/etc. transactions), which a production browser pass found was still reachable by real accounts. Root cause and fix:
- `VaultGate.tsx`'s setup path always starts a genuinely new (non-migrating) vault from `structuredClone(emptyProductionState)`, never the old sample data.
- `isLegacyDemoState()`/`removeLegacyDemoState()` (`src/data.ts`) conservatively detect *only* an exact, untouched match of the old sample dataset (exact account/goal fields, and every transaction using the old `tN` fixture-id convention) — any user edit at all makes the state ineligible for cleanup, so this can't discard real data. `VaultGate.tsx` runs this check once per unlock, right after `synchronizeUnlockedState`, and persists the cleaned state back via `saveState` so a stale cloud copy can't reintroduce the samples on the next device.
- "Clear financial data" (`DataTools.tsx`, formerly labelled "Reset financial data") explicitly promises "No example or demo data will be inserted" and produces the same `emptyProductionState` — it never reseeds anything. `resetFinancialData`'s acceptance-script coverage was previously (bug in the *test*, not the app) asserting the opposite — see [[Debugging Learnings]].
- Acceptance-only sample states (`accountsAcceptanceState`, `planningAcceptanceState`) remain, but are wired only through `VITE_ACCEPTANCE_FIXTURES`-gated `acceptanceMode` props, never through the production default.

## Encryption boundary

Server-side stores (`user-state-store.js`, `crypto-store.js`, `auth-store.js`) all use `aes-256-gcm` via Node's `crypto` module and assert `algorithm === 'AES-256-GCM'` on read as an integrity check. The frontend vault uses Web Crypto with PBKDF2-derived keys — a structurally different, independent encryption boundary from the server envelope (double encryption in transit: local vault format is re-derived per device, then wrapped again server-side).

## API contract

`GET/POST /api/finance/state` — see `docs/CLOUD_DATA.md` for the exact JSON shape. The endpoint independently validates on client and server: rejects unknown fields, malformed IDs, invalid dates, non-integer money, duplicate IDs, transactions referencing missing accounts, oversized payloads. Nginx and the connector both cap this route at 10 MB; other API routes use a smaller general limit.

Related: [[System Architecture]] · [[Sync and Offline]] · [[Authentication]] · [[COBOL Domain Core]]
