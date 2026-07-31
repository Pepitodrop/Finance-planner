# Finance Planner

Finance Planner is a privacy-focused personal finance application built with React, TypeScript, Node.js, PostgreSQL and GnuCOBOL. It combines deterministic financial calculations, an installable PWA, authenticated cross-device data synchronization, local browser AI, optional governed Hugging Face reasoning, behavior learning and bank/payment-provider integrations.

> **Status:** production-oriented personal MVP. The web/PWA deployment supports the same authenticated financial account across browsers and devices. Native store packages, independent security certification and live-bank-provider certification are still outstanding.

## What it does

- tracks accounts, balances, income, expenses, savings goals and recurring payments;
- uses integer cents and deterministic rules for monetary calculations;
- provides local ONNX-based transaction categorization and an optional local assistant;
- provides optional server-side Hugging Face analysis with explicit consent and deterministic fallback;
- learns user-confirmed merchant/category and recurring-payment patterns;
- supports Google authentication and WebAuthn passkeys;
- supports GoCardless and PayPal connector flows plus CSV/CAMT imports;
- runs as a responsive website and installable iOS/Android PWA;
- stores the authenticated user's full finance vault in PostgreSQL for cross-device access.

## Cross-device data model

**PostgreSQL is the canonical authenticated user-data store.** Browser storage is an encrypted offline cache, not the only copy.

After authentication and local vault unlock, Finance Planner synchronizes the complete per-user vault through:

```http
GET  /api/finance/state
POST /api/finance/state
```

The synchronized vault includes:

- accounts and balances;
- transactions and recurring flags;
- savings goals;
- behavior-learning graph data;
- assistant memory;
- secure client preferences used by the application.

Other account-related data is persisted separately:

| Data | Persistence | Protection |
|---|---|---|
| Finance vault | PostgreSQL `user_finance_state` | authenticated per-user access plus AES-256-GCM application encryption |
| Google profile and passkeys | PostgreSQL `auth_store` | AES-256-GCM application encryption |
| Bank/PayPal credentials | PostgreSQL `connector_connections` | encrypted provider payloads |
| OAuth nonces, webhook idempotency and rate limits | PostgreSQL operational tables | server-only access and strict validation |
| Offline device cache | browser vault | PBKDF2-SHA-256-derived key and AES-256-GCM |

Every cloud write contains an expected version. Concurrent edits from different devices produce an explicit conflict instead of silently overwriting data. The user can deliberately choose the server copy or the local copy.

This enables the same account and data on:

- any supported desktop or mobile browser;
- the installed PWA on iOS and Android;
- future native mobile or desktop clients that authenticate against the same API.

A native client is not yet distributed, but the persistence contract is no longer tied to one browser. See [`docs/CLOUD_DATA.md`](docs/CLOUD_DATA.md) for the API, encryption boundaries, database checks and cross-device acceptance test.

## Repository architecture

The frontend now uses a layered, feature-oriented structure. Root-level modules remain temporarily as compatibility entry points while large features are extracted incrementally.

```text
src/
├── app/                         application bootstrap and composition
├── domain/
│   └── finance/                 framework-independent finance types and rules
├── features/
│   └── sync/                    cloud-sync UI and conflict resolution
├── infrastructure/
│   └── persistence/             local-vault and cloud-state adapters
├── App.tsx                      current application shell
├── main.tsx                     minimal entrypoint
└── *.ts / *.tsx                 compatibility modules and remaining features

server/
├── migrations/                  ordered PostgreSQL schema migrations
├── src/
│   ├── user-state-store.js      encrypted, versioned user finance state
│   ├── auth-store.js            encrypted profiles and passkeys
│   ├── finance-router.js        finance calculations and state API
│   ├── database.js              pool and migration lifecycle
│   └── ...                      auth, providers, AI, security and webhooks
└── test/ and src/*.test.js      backend tests

core/cobol/                      deterministic fixed-point finance modules
public/                          PWA manifest, service worker and assets
deploy/                          Nginx production configuration
docs/                            architecture, cloud data, AI and operations
scripts/                         release checks, runtime vendoring and backups
.github/workflows/               CI for web, backend, containers and COBOL
```

Dependency direction:

- `domain` does not depend on React, HTTP or browser storage;
- `infrastructure` implements persistence and external interfaces;
- `features` combine domain behavior with infrastructure;
- `app` composes the product and global runtime components.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the detailed rules and migration strategy.

## Persistence flow

```text
React application state
        │
        ▼
local encrypted vault
(AppState + secureData)
        │ authenticated HTTPS
        ▼
/api/finance/state
        │ server-side AES-256-GCM envelope
        ▼
PostgreSQL user_finance_state
```

On a new device, the user signs in, creates or unlocks a device-local vault and then receives the account's server state before the main application mounts. The downloaded state is encrypted again with that device's local vault password.

When PostgreSQL or the network is unavailable, the application keeps the encrypted local cache and displays a local/offline status. It retries with bounded exponential backoff. It does not discard local changes.

## Supported delivery targets

| Platform | Current delivery model |
|---|---|
| Web | React application served by Nginx |
| iOS / Android | installable progressive web application |
| Linux | web/PWA and Docker deployment; no dedicated desktop package |
| Windows | web/PWA; no signed desktop installer |
| macOS | web/PWA; no signed and notarized desktop package |

The PWA includes offline shell support, safe-area handling, responsive layouts, controlled service-worker updates and mobile connectivity feedback.

## AI architecture

Exact finance remains separate from probabilistic AI. Balances, totals, projections and scenario metrics are deterministic. AI output is advisory, schema-validated and cannot execute payments or silently modify balances.

### Local models

| Model | Purpose |
|---|---|
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | multilingual transaction embeddings and categorization |
| `onnx-community/Qwen2.5-0.5B-Instruct` | local browser assistant where supported |
| `Xenova/flan-t5-small` | lower-resource local assistant fallback |

Transformers.js and ONNX Runtime are served from the application origin, with strict JavaScript/WASM MIME types and CSP-compatible loading.

### Hosted reasoning

The optional hosted analyst uses a reviewed immutable model revision and receives only an authenticated, restricted aggregate snapshot after explicit consent. Raw transaction descriptions, account names, identifiers, IBANs, credentials and access tokens are excluded.

```dotenv
HF_TOKEN=hf_...
HF_TIMEOUT_MS=30000
HF_MODEL=Qwen/Qwen3-4B-Thinking-2507:fastest
HF_MODEL_REVISION=768f209d9ea81521153ed38c47d515654e938aea
HF_CRITIC_ENABLED=false
HF_CRITIC_MODEL=Qwen/Qwen3-4B-Instruct-2507:fastest
HF_CRITIC_MODEL_REVISION=1b4199c4f36b0cef378bfb12390c18780c18af4c
```

The server rejects malformed, unsafe, unknown or unverified model output and returns deterministic finance signals instead. `HF_TIMEOUT_MS` defaults to 30 seconds in Compose, below the browser's 55-second request guard.

## Local development

Requirements:

- Node.js 22+
- npm
- optional GnuCOBOL for direct COBOL compilation

Start the frontend:

```bash
npm install
npm run dev
```

Start the backend in another terminal:

```bash
cd server
npm install
mkdir -p data
cat > .env <<EOF
PORT=8788
APP_ORIGIN=http://127.0.0.1:5173
AUTH_MODE=local
SESSION_SECRET=$(openssl rand -hex 32)
CONNECTOR_MASTER_KEY=$(openssl rand -hex 32)
AUTH_MASTER_KEY=$(openssl rand -hex 32)
CONNECTOR_STORE_PATH=./data/connectors.enc.json
EOF
set -a; source .env; set +a
node src/server.js
```

Without PostgreSQL, local development uses encrypted server files and the browser remains in local-only finance-storage mode. Cross-device finance synchronization requires `CONNECTOR_STORE_DRIVER=postgres` and `DATABASE_URL`.

`vite.config.ts` proxies `/api` and health requests to `http://127.0.0.1:8788`.

For normal authenticated development, configure Google OAuth and register this callback:

```text
http://127.0.0.1:5173/api/auth/google/callback
```

## Tests

Frontend, architecture and release checks:

```bash
npm test
npm run lint
npm run build
npm run verify:cloud-state
```

Backend:

```bash
cd server
npm install
npm test
npm audit --omit=dev
```

CI additionally compiles the COBOL modules, builds production containers and validates Compose.

## Production deployment

Create `.env` from `.env.example` and configure at least:

```dotenv
APP_ORIGIN=https://finance.example.com
PUBLIC_DEPLOYMENT=true
AUTH_MODE=google
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
CONNECTOR_MASTER_KEY=...
AUTH_MASTER_KEY=...
POSTGRES_DB=finance_planner
POSTGRES_USER=finance_planner
POSTGRES_PASSWORD=...
HF_TIMEOUT_MS=30000
```

Generate `SESSION_SECRET`, `CONNECTOR_MASTER_KEY` and `AUTH_MASTER_KEY` independently. Keep them outside source control. Losing an encryption key can make its database payloads unrecoverable.

Deploy:

```bash
docker compose build --pull web connector
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/ready
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/healthz
```

Connector startup applies ordered migrations, including `006_cloud_user_data.sql` for finance and authentication documents.

Verify cross-device tables:

```bash
set -a; . ./.env; set +a

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT version FROM schema_migrations ORDER BY version;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT user_id, version, updated_at FROM user_finance_state;"

docker compose exec -T postgres psql \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT id, updated_at FROM auth_store;"
```

Public deployments must use HTTPS, keep PostgreSQL and the connector private, use a real authentication mode, back up the database and encryption keys separately, and monitor readiness, HTTP 5xx rates, AI fallback rates, storage usage and backup age.

## Backup and recovery

The PostgreSQL dump is the primary backup for user finance state, authentication data, connector credentials, webhook state and distributed rate limits.

A production backup is only considered valid after:

1. `pg_dump` succeeds;
2. the dump checksum is recorded;
3. `pg_restore --list` succeeds;
4. the dump is restored into a disposable database;
5. the restored schema and representative rows are verified.

Store database dumps separately from `CONNECTOR_MASTER_KEY` and `AUTH_MASTER_KEY`, while ensuring both key sets are recoverable during an authorized disaster-recovery operation. See [`docs/DATABASE.md`](docs/DATABASE.md) and [`docs/CLOUD_DATA.md`](docs/CLOUD_DATA.md).

## Security boundaries

- financial API routes require an authenticated session;
- cloud documents are isolated by session user ID;
- finance and auth documents are encrypted before database storage;
- provider credentials remain server-side and encrypted;
- raw bank credentials and provider tokens never enter the finance state document;
- state input is independently validated on client and server;
- transactions must reference an existing account;
- monetary values are safe integer cents;
- conflicting device writes fail closed;
- AI suggestions remain approval-gated.

This repository has not completed an independent penetration test or formal privacy assessment. Do not use it as the sole unrecoverable record of important financial information.

## Remaining production gaps

- representative Playwright, accessibility, load and physical-device test matrices;
- independent threat model, penetration test and privacy review;
- formal data-retention, account-deletion and recovery workflows;
- managed monitoring, tracing, SLOs and paging;
- live GoCardless/PayPal certification and reconciliation testing;
- safe multi-instance coordination for the encrypted whole-document auth store;
- signed native mobile and desktop packages;
- representative AI quality, latency, drift and safety benchmarks.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — source layout and dependency rules
- [`docs/CLOUD_DATA.md`](docs/CLOUD_DATA.md) — cross-device persistence and acceptance tests
- [`docs/DATABASE.md`](docs/DATABASE.md) — database operations and restore drill
- [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — deployment and incident response
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting
- [`CHANGELOG.md`](CHANGELOG.md) — release history

## License

No license has been selected. Until one is added, all rights are reserved by the repository owner.
