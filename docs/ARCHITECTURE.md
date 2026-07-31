# Architecture

Finance Planner uses a layered, feature-oriented structure. New code must not add another unrelated module directly to the root of `src/`.

## Frontend

```text
src/
├── app/                         application bootstrap and composition
├── domain/
│   └── finance/                 framework-independent finance types and rules
├── features/
│   └── sync/                    user-facing cloud synchronization
├── infrastructure/
│   └── persistence/             local vault and authenticated cloud adapters
├── App.tsx                      current application shell; gradual extraction target
├── *.tsx / *.ts                 compatibility modules awaiting feature extraction
└── main.tsx                     minimal entrypoint importing app/bootstrap
```

The root compatibility exports allow the architecture to improve without a risky one-shot rewrite. When a root module is substantially changed, move its implementation into the appropriate layer and leave a small re-export only when existing imports still need it.

### Dependency direction

- `domain` imports no React, browser storage or HTTP code.
- `infrastructure` may depend on domain validation and browser APIs.
- `features` may depend on domain and infrastructure.
- `app` composes features and global runtime guards.
- compatibility modules may temporarily point inward, but new inner-layer modules must not import from `app`.

## Persistence flow

```text
React state
   │
   ▼
local AES-256-GCM vault
   │  full payload: AppState + secureData
   ▼
authenticated /api/finance/state
   │
   ▼
AES-256-GCM server envelope
   │
   ▼
PostgreSQL user_finance_state
```

The browser vault remains an encrypted offline cache. PostgreSQL is the canonical cross-device copy. The cloud document includes accounts, transactions, savings goals, behavior-learning data, assistant memory and other secure vault values.

Writes use optimistic version checks. A conflicting write is never silently accepted; the UI requires the user to choose the server or local version.

## Backend

```text
server/
├── migrations/                  ordered PostgreSQL migrations
├── src/
│   ├── auth-store.js            encrypted auth profile/passkey persistence
│   ├── user-state-store.js      encrypted finance-vault persistence
│   ├── finance-router.js        finance calculations and state API
│   ├── database.js              pool lifecycle and migrations
│   └── ...                      authentication, providers, AI and security
└── test/ / src/*.test.js        Node test runner coverage
```

Provider credentials remain encrypted separately in `connector_connections`. Authentication profiles and passkeys are stored as an encrypted database document in `auth_store`. Financial vault documents are encrypted per user in `user_finance_state`.

## Financial correctness

- Monetary values use integer cents.
- Exact balances and projections remain deterministic.
- AI output is advisory and cannot mutate balances without explicit user action.
- Server and client validate state shape independently.
- Transactions must reference an existing account.
- Database writes are versioned and authenticated.
