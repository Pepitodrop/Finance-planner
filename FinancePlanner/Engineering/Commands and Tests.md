# Commands and Tests

## Health stack (also in root `CLAUDE.md` — keep in sync, don't duplicate authority)

- typecheck: `tsc -b --noEmit`
- lint: `eslint .`
- test: `npm test`

## Frontend (root)

```bash
npm install
npm run dev            # vite dev server (predev vendors transformers runtime)
npm run build           # tsc -b && vite build
npm run lint             # eslint .
npm test                 # vitest run + a long chain of scripts/verify-*.mjs gates
npm run verify:cloud-state
npm run android:verify
```

`npm test` is not just Vitest — it chains `verify-pwa`, `verify-mobile`, `verify-web-mobile-hardening`, `verify-frontend-experience`, `verify-mobile-bank-production`, `verify-android-app`, `verify-ai`, `verify-ai-evaluation`, `verify-ai-quality-gates`, `verify-ai-model-lock`, `verify-budget-learning-quality`, `verify-cloud-state`, `verify-personal-launch`, `verify-production-readiness`, `verify-non-desktop-readiness`, `verify-test-password-leakage`, `verify-english-runtime-chrome`. A green `npm test` is a broad regression net, not just unit tests.

## Backend (`server/`)

```bash
cd server
npm install
npm test
npm audit --omit=dev
```

## COBOL

```bash
cd core/cobol
cobc -Wall -Wextra -m finance_projection.cob
cobc -Wall -Wextra -x -o ../../build/transaction-rules transaction_rules.cob
```
GnuCOBOL (`cobc`) is required to compile; the compiled binary is then a runtime dependency for the connector (see [[COBOL Domain Core]]). `server/test/cobol-engine.test.js` / `cobol-banking-core.test.js` need the binary compiled first — known to fail with `ENOENT` in sandboxes without GnuCOBOL (see [[Known Issues and Limitations]]).

## Android

```bash
cd android
gradle --no-daemon :app:lintDebug :app:testDebugUnitTest :app:assembleDebug
```

## Docker / deployment

```bash
docker compose build --pull web connector
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/ready
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/healthz
```

## Release / readiness scripts worth knowing

- `npm run verify:release` — `verify-production-readiness.mjs --strict`
- `npm run verify:readiness` — `verify-non-desktop-readiness.mjs`
- `npm run test:providers:runtime` — `provider-runtime-canary.mjs` (GoCardless/PayPal control-plane check)
- `npm run test:browser:production` — `run-browser-production-acceptance.mjs`

Related: [[Known Issues and Limitations]], [[Deployment]]
