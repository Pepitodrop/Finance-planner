# Finance Planner

Finance Planner is an offline-first personal finance application built with React, TypeScript, Node.js, and GnuCOBOL. It combines responsive financial dashboards, deterministic money calculations, local AI assistance, optional privacy-minimised Hugging Face reasoning, behavior-pattern learning, and optional bank/payment-provider connections.

> **Project status:** hardened MVP. The repository includes production-oriented containers, CI, encrypted connector storage, backup and restore tooling, health checks, and operational documentation. It has not yet completed an independent security audit, live-provider certification, or multi-instance database migration.

## Capabilities

- responsive web dashboard and installable mobile PWA
- account, balance, income, expense, savings-goal, and recurring-payment tracking
- deterministic integer-cent financial calculations
- GnuCOBOL transaction normalization, balance updates, and savings projections
- local browser AI using ONNX-compatible Hugging Face models
- governed server-side Hugging Face analyst/critic reasoning with deterministic fallback
- deterministic savings-rate, recurring-cost-share, and liquidity-runway scenario intelligence
- adaptive transaction categorization and a privacy-preserving behavior-learning engine
- governed catalog for semantic-search, speech, and vision models
- authenticated GoCardless and PayPal connector flows
- encrypted backend persistence with corruption recovery and previous-generation backup
- production containers, readiness checks, rate limiting, structured logs, and graceful shutdown

## Supported applications

| Platform | Current delivery model |
|---|---|
| Web | React application served by Nginx |
| Mobile | Installable iOS/Android progressive web application |
| Linux | Docker deployment; no dedicated desktop package yet |
| Windows | Web/PWA only; no signed desktop installer yet |
| macOS | Web/PWA only; no signed and notarized desktop package yet |

The PWA includes safe-area handling, standalone launch metadata, offline-state feedback, controlled service-worker updates, installation UX, and CI checks for mobile invariants. Native store packaging, signing, push notifications, biometric vault access, and physical-device certification remain future milestones.

## AI architecture

Finance Planner separates exact financial computation from probabilistic AI. Balances, transaction totals, savings projections, scenario metrics, and other monetary values remain deterministic. AI output is advisory, schema-validated, bounded, and cannot execute transactions or modify balances.

### Included Hugging Face models

| Model | Runtime | Purpose | Current state |
|---|---|---|---|
| `onnx-community/Qwen2.5-0.5B-Instruct` | Browser/WebGPU or WASM | Local conversational assistance | Enabled where supported |
| `Xenova/flan-t5-small` | Browser/WASM | Lower-resource local assistant fallback | Enabled as fallback |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | Browser/ONNX | Local multilingual transaction embeddings and categorization | Enabled |
| `Qwen/Qwen3-4B-Thinking-2507:fastest` | Hosted or self-hosted Hugging Face runtime | Governed primary financial analyst | Optional; requires `HF_TOKEN` and explicit consent for hosted inference |
| `Qwen/Qwen3-4B-Instruct-2507:fastest` | Hosted or self-hosted Hugging Face runtime | Independent second-pass critic and confidence calibration | Integrated; disabled by default |
| `BAAI/bge-m3` | Sandboxed local worker | Multilingual semantic retrieval and clustering | Worker-ready; disabled by default |
| `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Sandboxed local worker | Lightweight multilingual semantic search | Worker-ready; disabled by default |
| `openai/whisper-tiny` | Sandboxed local worker | Lightweight German/English voice entry | Worker-ready; disabled by default |
| `microsoft/Florence-2-base` | Sandboxed local worker | Receipt and invoice image extraction | Worker-ready; disabled by default |

Model weights are not committed to this repository. “Free” means the project introduces no proprietary model licence fee. Hosted Hugging Face inference can still consume provider credits or incur usage charges, while local execution consumes CPU, RAM, storage, and possibly GPU capacity.

The model catalog is available through the authenticated endpoint:

```http
GET /api/ai/models
```

### Local semantic transaction intelligence

`Xenova/paraphrase-multilingual-MiniLM-L12-v2` provides multilingual embeddings for transaction categorization, merchant normalization, similarity analysis, and explainable confidence scoring.

### Local adaptive assistant

The browser assistant uses:

1. `onnx-community/Qwen2.5-0.5B-Instruct` as the primary local model, using WebGPU where available;
2. `Xenova/flan-t5-small` as a lower-resource fallback;
3. deterministic routing for balances, recurring costs, cash flow, and other exact monetary answers;
4. local conversational context and a user-confirmed merchant/category behavior graph.

This local model stack does not send financial data to a hosted inference API.

### Guarded external financial reasoning

`Qwen/Qwen3-4B-Thinking-2507:fastest` is the governed primary server-side analyst. An optional independent `Qwen/Qwen3-4B-Instruct-2507:fastest` critic can review the analyst output. When enabled, only signals independently supported by both models are retained, confidence is capped across both passes, and agreement metadata is exposed.

Both runtime models are locked to reviewed immutable revisions. An unknown model, malformed revision, or revision that differs from the reviewed production lock fails closed to deterministic output.

The hosted path receives only a restricted aggregate snapshot after authentication and explicit external-AI consent. The snapshot may include integer-cent totals, transaction count, covered months, ranked category totals, and remaining savings-goal amounts. It excludes raw merchant descriptions, account names, transaction identifiers, IBANs, credentials, and access tokens.

```http
POST /api/ai/financial-intelligence
Content-Type: application/json
```

The backend validates each model response against strict allowlists and size limits. Unsupported, malformed, timed-out, unavailable, or unreviewed model output is replaced with deterministic financial signals. Every suggested action remains approval-gated.

Configure the hosted reasoning layer with:

```bash
HF_TOKEN=hf_...
HF_MODEL=Qwen/Qwen3-4B-Thinking-2507:fastest
HF_MODEL_REVISION=768f209d9ea81521153ed38c47d515654e938aea

# Optional independent critic
HF_CRITIC_ENABLED=true
HF_CRITIC_MODEL=Qwen/Qwen3-4B-Instruct-2507:fastest
HF_CRITIC_MODEL_REVISION=1b4199c4f36b0cef378bfb12390c18780c18af4c
```

Never expose `HF_TOKEN` through Vite variables or client-side bundles.

### Deterministic scenario intelligence

Scenario intelligence does not require external inference. It calculates savings rate, recurring-expense share, liquidity runway, and bounded warning signals directly from the validated aggregate snapshot.

```http
POST /api/ai/scenario-intelligence
Content-Type: application/json
```

The same scenario metrics are included with deterministic fallback responses from the financial-intelligence endpoint.

### Behavior learning and predictions

The behavior learner derives user-specific patterns from structured financial history without accepting raw descriptions, merchant names, account identifiers, credentials, or arbitrary text.

It can learn from a bounded rolling history and identify:

- typical income and expense levels;
- recurring-cost pressure;
- category concentration;
- weekday spending patterns;
- weekly volatility;
- changes that may affect the next finance plan.

It produces bounded advisory predictions for the next 30 days, including expected income, expenses, and free cash flow. Predictions include confidence and evidence, require explicit behavior-learning consent, and never execute financial actions.

```http
POST /api/ai/behavior-prediction
Content-Type: application/json
```

Current privacy and safety constraints:

- maximum 5,000 structured events;
- rolling 120-day learning window;
- user-specific input only;
- no raw descriptions or identifiers;
- no persistence inside the learner;
- unknown fields are rejected;
- all recommendations remain approval-gated.

The current first-stage learner is deterministic and inspectable. Additional semantic, speech, and vision capabilities remain disabled until their sandboxed workers have representative evaluation data, measurable accuracy thresholds, resource budgets, and privacy review.

## Backend and COBOL API

The Node.js backend provides authentication, provider synchronization, encrypted connector storage, deterministic COBOL calculations, guarded AI routing, scenario intelligence, and behavior-pattern prediction.

Authenticated savings projection endpoint:

```http
POST /api/finance/project-savings
Content-Type: application/json
```

```json
{
  "balanceCents": 100000,
  "monthlyContributionCents": 25000,
  "months": 12
}
```

The response contains `projectedBalanceCents` and identifies the calculation engine as `cobol`. Money values use integer cents; projection months must be between 0 and 1200.

## Local development

Requirements:

- Node.js 22+
- npm
- optional GnuCOBOL for direct COBOL compilation

`npm install` alone is not enough to see a working app — it only starts the
frontend shell, which needs the connector backend to reach anything past the
sign-in screen. Run both:

```bash
npm install
npm run dev
```

In a second terminal, start the connector backend (no Docker or Postgres
required for local dev — it falls back to an encrypted local file store):

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
CONNECTOR_STORE_PATH=./data/connectors.enc.json
EOF
set -a; source .env; set +a
node src/server.js
```

`vite.config.ts` already proxies `/api` and `/health/ready` from `:5173` to
`http://127.0.0.1:8788` in dev, so the two servers talk to each other with no
extra setup. If you change the connector's port, update the `proxy` block in
`vite.config.ts` to match.

**Signing in locally:** `AUTH_MODE=local` seeds a `local-user` account, but
there is currently no passwordless local sign-in — the app only supports
Google OAuth or a WebAuthn passkey, and registering a first passkey requires
already having a session (a chicken-and-egg gap tracked as a known
limitation). For local development that needs to reach authenticated screens,
configure real Google OAuth credentials in `server/.env`:

```bash
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

then use "Continue with Google" on the sign-in screen. Set the OAuth
redirect URI in your Google Cloud Console project to
`http://127.0.0.1:5173/api/auth/google/callback`.

Run the frontend validation suite:

```bash
npm test
npm run lint
npm run build
```

Run backend tests:

```bash
cd server
npm install
npm test
```

Compile the COBOL modules manually:

```bash
mkdir -p build
cobc -Wall -Wextra -m core/cobol/finance_projection.cob
cobc -Wall -Wextra -x -o build/transaction-rules core/cobol/transaction_rules.cob
```

## Container deployment

The Compose stack is a hardened **single-host** deployment baseline. It must not be scaled to multiple connector replicas while using the file-backed encrypted store.

```bash
cp .env.example .env
# Replace every example secret and configure the required providers.
docker compose build --pull
docker compose up -d
docker compose ps
```

The connector container always runs with `NODE_ENV=production` (baked into
`Dockerfile.server`) and now refuses to start with `AUTH_MODE=local` in that
mode, full stop — you must set `AUTH_MODE` to a real provider (`google`, or
another configured mode) in `.env` before running Compose. This is
intentional: `AUTH_MODE=local` mints sessions with no credential check at all,
so it must never be reachable outside a trusted local dev machine.

Verify service health:

```bash
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/ready
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/
```

Public deployments must:

- use HTTPS and set `APP_ORIGIN` to the exact public origin;
- set `PUBLIC_DEPLOYMENT=true`;
- use a configured production authentication mode, never `AUTH_MODE=local`;
- generate independent high-entropy `SESSION_SECRET` and `CONNECTOR_MASTER_KEY` values;
- keep the connector port private;
- keep all model-provider tokens server-side;
- configure live provider credentials explicitly;
- centralize logs and alert on readiness failures, restart loops, HTTP 5xx rates, provider errors, AI fallback rates, schema failures, latency, disk usage, and backup age.

The complete deployment, monitoring, rollback, incident-response, and disaster-recovery requirements are in [`docs/PRODUCTION.md`](docs/PRODUCTION.md).

## Backup and restore

Create an integrity-protected backup of the encrypted connector-data volume:

```bash
./scripts/backup-connector-data.sh
```

Restore during a maintenance window only:

```bash
./scripts/restore-connector-data.sh backups/<archive>.tar.gz
```

The restore script verifies the SHA-256 checksum, refuses to operate while the connector is running, and requires explicit destructive-operation confirmation. Store backup archives, checksums, and encryption keys in separate protected locations. Test restoration regularly in a disposable environment.

## CI and release gates

GitHub Actions validates:

- frontend unit tests, TypeScript, production build, and dependency audit;
- backend tests, syntax, dependency audit, and GnuCOBOL compilation;
- COBOL transaction behavior;
- production container builds and Compose configuration;
- PWA and mobile invariants;
- governed AI ensemble, immutable model locks, scenario intelligence, schemas, safety controls, and behavior-learning constraints.

A production release should require green CI for the exact commit, verified backups and restoration, documented rollback artifacts, validated OAuth callbacks, no unresolved critical/high vulnerabilities, and an accountable release owner.

## Architecture

```text
src/                    React/TypeScript web app, PWA runtime, and local AI
public/                 manifest, service worker, and install assets
server/                 authentication, providers, encrypted storage, COBOL and AI APIs
core/cobol/             deterministic fixed-point financial calculations
deploy/                 web-server deployment configuration
docs/                   production, AI, privacy, and operations guidance
scripts/                backup and restore tooling
.github/workflows/      frontend, backend, container, mobile, AI, and COBOL CI
```

## Known production gaps

The largest remaining gaps are tracked in the production-readiness roadmap and include:

- shared transactional database and versioned migrations;
- managed production identity and session infrastructure;
- distributed rate limiting and multi-instance coordination;
- metrics, tracing, dashboards, paging, SLOs, and automated recovery exercises;
- full live-provider integration and reconciliation testing;
- Playwright end-to-end, accessibility, load, and physical-device test matrices;
- signed native mobile and desktop releases;
- formal threat modeling, penetration testing, privacy review, retention controls, data export, and account deletion;
- pinned revisions and software-bill-of-materials coverage for every model enabled in production;
- representative AI and behavior-prediction evaluation datasets;
- measurable accuracy, abstention, agreement, drift, latency, memory, fallback-rate, and safety thresholds;
- dedicated sandboxed workers for speech, vision, and semantic-search inference before those capabilities are enabled in production.

## Security

Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Do not include credentials, access tokens, financial records, or exploit details in public issues.

This application has not undergone a formal independent security assessment. Do not use it as the sole record of important financial information. Generated analyses, predictions, and plans are advisory and are not professional financial advice.

## License

No license has been selected yet. Until a license is added, all rights are reserved by the repository owner.