# System Architecture

## Components

- **Frontend** (`src/`) — React 18 + TypeScript SPA, built with Vite, served by Nginx (`Dockerfile.web`, `deploy/nginx.conf`) in production. See [[Frontend]].
- **Connector backend** (`server/`) — Node.js service (`server/src/server.js`), bound to loopback only in Compose (`127.0.0.1:${CONNECTOR_PORT:-8787}`); Nginx is the only reachable path to it. See [[Backend]].
- **PostgreSQL** — canonical cross-device data store (`postgres:17-bookworm` in Compose). See [[Data and Persistence]].
- **COBOL domain core** (`core/cobol/`) — compiled GnuCOBOL binaries invoked by the connector via subprocess for deterministic finance and banking-domain decisions. See [[COBOL Domain Core]].
- **External providers** — GoCardless (bank data), PayPal, Hugging Face (hosted AI), Google (OAuth). All credentials and tokens stay server-side; never reach the browser or the COBOL process (`docs/issue-105-provider-setup.md`).
- **Android TWA** (`android/`) — Trusted Web Activity wrapping the same web origin, not a separate WebView database. See [[Mobile PWA Android]].

## Boundaries and dependency direction

- Frontend `domain/finance` code imports nothing from React, HTTP, or browser storage (`docs/ARCHITECTURE.md`).
- `infrastructure/persistence` implements local-vault and cloud adapters; `features` compose domain + infrastructure; `app` composes the whole product.
- Backend: routers (`finance-router.js`, `auth-router.js`, `budget-router.js`, `ai-router.js`, `google-subscriptions-router.js`) sit above stores (`user-state-store.js`, `auth-store.js`, `crypto-store.js`, `postgres-store.js`) which sit above `database.js` (pool + migrations).
- Node.js is deliberately limited to transport, OAuth redirects, bounded JSON parsing, encrypted persistence, sessions, retries and authorization for banking operations — **not** financial decision logic. The COBOL core owns provider account-type normalization, fixed-point amount conversion, consent-state classification, scope enforcement and reconciliation (`docs/OPEN_BANKING_ARCHITECTURE.md`). Provider responses are not accepted into state until COBOL validates them.

## How the pieces interact

```
Browser (React SPA)
  │ local AES-256-GCM vault (offline cache)
  ▼
/api/finance/state  (authenticated, versioned)
  ▼
Connector (Node) ── execFile ──▶ compiled COBOL binaries (deterministic math/banking rules)
  │ AES-256-GCM envelope (CONNECTOR_MASTER_KEY / AUTH_MASTER_KEY)
  ▼
PostgreSQL (user_finance_state, auth_store, connector_connections, oauth_nonces, webhook_events, rate_limit_windows)
```

External provider calls (GoCardless, PayPal, Hugging Face, Google) originate only from the connector, never the browser or COBOL.

## Related

[[Frontend]] · [[Backend]] · [[Data and Persistence]] · [[COBOL Domain Core]] · [[Authentication]] · [[Bank Connections]] · [[Provider Status]]
