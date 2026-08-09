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

## Encryption boundary

Server-side stores (`user-state-store.js`, `crypto-store.js`, `auth-store.js`) all use `aes-256-gcm` via Node's `crypto` module and assert `algorithm === 'AES-256-GCM'` on read as an integrity check. The frontend vault uses Web Crypto with PBKDF2-derived keys — a structurally different, independent encryption boundary from the server envelope (double encryption in transit: local vault format is re-derived per device, then wrapped again server-side).

## API contract

`GET/POST /api/finance/state` — see `docs/CLOUD_DATA.md` for the exact JSON shape. The endpoint independently validates on client and server: rejects unknown fields, malformed IDs, invalid dates, non-integer money, duplicate IDs, transactions referencing missing accounts, oversized payloads. Nginx and the connector both cap this route at 10 MB; other API routes use a smaller general limit.

Related: [[System Architecture]] · [[Sync and Offline]] · [[Authentication]] · [[COBOL Domain Core]]
