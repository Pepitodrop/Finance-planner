# Finance Planner

Finance Planner is an offline-first personal finance application built with React, TypeScript, Node.js, and GnuCOBOL. It combines responsive financial dashboards, deterministic money calculations, local AI assistance, and optional bank/payment-provider connections.

> **Project status:** hardened MVP. The repository includes production-oriented containers, CI, encrypted connector storage, backup and restore tooling, health checks, and operational documentation. It has not yet completed an independent security audit, live-provider certification, or multi-instance database migration.

## Capabilities

- responsive web dashboard and installable mobile PWA
- account, balance, income, expense, savings-goal, and recurring-payment tracking
- deterministic integer-cent financial calculations
- GnuCOBOL transaction normalization, balance updates, and savings projections
- local browser AI using ONNX-compatible Hugging Face models
- adaptive transaction categorization and a local behavior-learning graph
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

### Semantic transaction intelligence

`Xenova/paraphrase-multilingual-MiniLM-L12-v2` provides multilingual embeddings for transaction categorization, merchant normalization, similarity analysis, and explainable confidence scoring.

### Adaptive assistant

The local assistant uses:

1. `onnx-community/Qwen2.5-0.5B-Instruct` as the primary browser model, using WebGPU where available;
2. `Xenova/flan-t5-small` as a lower-resource fallback;
3. deterministic routing for balances, recurring costs, cash flow, and other exact monetary answers;
4. local conversational context and a user-confirmed merchant/category behavior graph.

Financial data is not sent to a hosted inference API by this model stack. The assistant is advisory and cannot execute transactions or modify balances directly.

## Backend and COBOL API

The Node.js backend provides authentication, provider synchronization, encrypted connector storage, and deterministic COBOL calculations.

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

```bash
npm install
npm run dev
```

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
- configure live provider credentials explicitly;
- centralize logs and alert on readiness failures, restart loops, HTTP 5xx rates, provider errors, disk usage, and backup age.

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
- PWA and mobile invariants.

A production release should require green CI for the exact commit, verified backups and restoration, documented rollback artifacts, validated OAuth callbacks, no unresolved critical/high vulnerabilities, and an accountable release owner.

## Architecture

```text
src/                    React/TypeScript web app, PWA runtime, and local AI
public/                 manifest, service worker, and install assets
server/                 authentication, providers, encrypted storage, and COBOL API
core/cobol/             deterministic fixed-point financial calculations
deploy/                 web-server deployment configuration
docs/                   production operations guidance
scripts/                backup and restore tooling
.github/workflows/      frontend, backend, container, mobile, and COBOL CI
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
- representative AI evaluation datasets and measurable accuracy, abstention, latency, and safety thresholds.

## Security

Report vulnerabilities privately according to [`SECURITY.md`](SECURITY.md). Do not include credentials, access tokens, financial records, or exploit details in public issues.

This application has not undergone a formal independent security assessment. Do not use it as the sole record of important financial information. Generated analyses and plans are advisory and are not professional financial advice.

## License

No license has been selected yet. Until a license is added, all rights are reserved by the repository owner.
