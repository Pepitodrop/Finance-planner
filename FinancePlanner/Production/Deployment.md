# Deployment

## Topology (`compose.yaml`)

Three services:
- **`web`** — built from `Dockerfile.web`, Nginx, read-only root FS, tmpfs for cache/run dirs, capabilities dropped except `CHOWN`/`SETGID`/`SETUID`/`NET_BIND_SERVICE`, healthcheck on `/healthz`, published on `${WEB_PORT:-8080}`.
- **`postgres`** — `postgres:17-bookworm`, env-configured DB/user/password (required, no default), `postgres-data` volume, `pg_isready` healthcheck.
- **`connector`** — built from `Dockerfile.server`, depends on healthy postgres, large env block (auth, WebAuthn RP config, session/master keys — required, HF model pins, GoCardless/PayPal creds, rate limiting, retention, `COBOL_BANKING_REQUIRED` default `true`), published **only on `127.0.0.1:${CONNECTOR_PORT:-8787}`** — loopback-only by design, Nginx is the sole reachable path.

## Nginx (`deploy/nginx.conf`, `deploy/security-headers.conf`)

Listens on 8080, serves the built SPA from `/usr/share/nginx/html`. Proxies `/health/ready` and `/api/finance/state` to the connector (10 MB body limit + extended timeouts specifically for the encrypted vault payload route). `/healthz` is served directly by Nginx, not proxied — fast liveness check independent of the connector/DB.

## Migrations

`server/src/migrate.js` — forward migrations (`migrateDatabase`), advisory-lock pattern, idempotent (`schema_migrations` table, `ON CONFLICT DO NOTHING`). `server/src/migrate-rollback.js` — CLI `node src/migrate-rollback.js <target-version>` rolls back every migration newer than target using matching files in `server/migrations/down/`; refuses a partial rollback if any down-migration file is missing (fail-closed, not "best effort"). Added 2026-08-03 (`TODOS.md`) — before that, backup-restore was the only rollback story.

## Pre-deployment gate (`docs/PRODUCTION.md`)

1. Confirm CI, Android CI and production-browser acceptance passed for the exact commit.
2. `npm run verify:readiness`, review external-dependency disclosures.
3. Build from a clean checkout, run dependency + container scans.
4. Validate Compose with production env values.
5. Back up PostgreSQL + encryption keys separately.
6. Restore the backup into a disposable environment, verify representative rows.
7. Verify OAuth callbacks, provider environments, webhook secrets.
8. Verify HTTPS, CSP, CORS, auth, passkeys, account deletion.
9. Record release version, commit, image digests, rollback images.
10. Run manually-enforced runtime canaries with real HF/provider credentials.

## CI workflows (`.github/workflows/`)

- `ci.yml` — main CI: `npm test` (full verify-gate chain), typecheck, production build, `npm audit`, connector-server job, container build + Trivy scan (SHA-pinned action).
- `android.yml` — builds (and, with secrets, release-signs) the Android APK/AAB on relevant PRs/main.
- `hosted-ai-acceptance.yml` — hosted HF inference check on PR + manual dispatch, `require_live_ai` only forced on manual dispatch.
- `live-deployment-smoke.yml` — manual/PR smoke test against a public deployment URL.
- `production-acceptance.yml` — full Chromium acceptance suite (desktop/mobile/offline/a11y/connections/auth/data-privacy/readiness/resilience/load) run under `AUTH_MODE=local`.
- `production-operations.yml` — production-ops acceptance, optional `require_live_bank` input.
- `release-readiness.yml` — manual-dispatch gate for creating a semver release tag.
- `runtime-canaries.yml` — weekly + manual, GoCardless/PayPal control-plane + HF inference availability canaries.
- `security-analysis.yml` — PR/main/weekly static/security analysis.

Related: [[System Architecture]], [[Security]], [[Provider Status]]
