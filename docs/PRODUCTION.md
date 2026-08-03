# Production operations runbook

This runbook defines the minimum deployment and operating standard for Finance Planner. It is intentionally stricter than local development.

## 1. Deployment model

The supported baseline is one web container, one connector container and PostgreSQL on a trusted host. Place a TLS-terminating reverse proxy or managed load balancer in front of the web service. Keep PostgreSQL private and keep the connector host port bound to loopback.

The connector uses PostgreSQL for encrypted user finance state, auth/passkey data, provider connections, OAuth state, webhook idempotency, session revocation and distributed rate limiting. File-backed persistence is development-only for a public deployment.

## 2. Required production configuration

Copy `.env.example` into a deployment-specific secret source. A public deployment requires at least:

```dotenv
APP_ORIGIN=https://finance.example.com
AUTH_MODE=google
PUBLIC_DEPLOYMENT=true
CONNECTOR_STORE_DRIVER=postgres
TRUST_PROXY=true
SESSION_SECRET=<independent-random-secret>
CONNECTOR_MASTER_KEY=<independent-random-secret>
AUTH_MASTER_KEY=<independent-random-secret>
METRICS_TOKEN=<independent-random-secret>
RELEASE_VERSION=<release-version>
RELEASE_SHA=<exact-git-commit>
PAYPAL_ENVIRONMENT=live
```

Generate every secret independently with at least 256 bits of entropy. Store secrets in the platform secret manager. Never bake them into an image, commit them, or print them in logs.

`TRUST_PROXY=true` trusts the proxy-provided `X-Real-IP`. The bundled Nginx path overwrites this header, and the connector port is bound to host loopback. Restrict host-level access and ensure every additional CDN or load balancer strips or overwrites client-supplied forwarding headers.

## 3. Pre-deployment gate

Before every production release:

1. Confirm standard CI, Android CI and production-browser acceptance succeeded for the exact commit.
2. Run `npm run verify:readiness` and review its external-dependency disclosures.
3. Build images from a clean checkout and run dependency and container scans.
4. Validate Compose with production environment values.
5. Back up PostgreSQL and encryption keys separately.
6. Restore the backup into a disposable environment and verify representative encrypted rows.
7. Verify OAuth callbacks, provider environments and webhook secrets.
8. Verify HTTPS, CSP, CORS, authentication, passkeys and account deletion.
9. Record release version, commit, image digests and rollback images.
10. Run manually enforced runtime canaries with the intended Hugging Face and provider credentials.

## 4. Start and verify

```bash
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/ready
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/bank
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/healthz
curl --fail \
  -H "Authorization: Bearer $METRICS_TOKEN" \
  http://127.0.0.1:${CONNECTOR_PORT:-8787}/metrics
```

Do not route traffic before web and connector readiness succeed. `/health/ready` reports the deployed version and commit, persistence backend, distributed rate limiting, session-revocation mode, observability and bank-production capability.

## 5. Monitoring and alerting

`/metrics` exposes privacy-safe Prometheus metrics after bearer-token authentication. Route labels are normalized and never contain user IDs, query strings, transaction descriptions, account names or credentials.

Collect and alert on:

- request volume and latency percentiles by normalized route;
- HTTP 5xx and 429 rates;
- authentication and account-deletion failures;
- provider synchronization, consent-expiry and webhook failures;
- AI hosted/deterministic fallback ratio;
- retention-job failures;
- PostgreSQL pool saturation, disk usage and backup age;
- readiness failures, restart loops and certificate expiry;
- release version and commit mismatch.

Keep metrics access private. Central logs may contain request IDs, normalized paths, status and duration, but must not contain cookies, tokens, encryption keys, request bodies or full financial records.

## 6. Retention and account deletion

Operational cleanup runs periodically in PostgreSQL. Defaults are:

```dotenv
RETENTION_INTERVAL_MS=21600000
WEBHOOK_RETENTION_DAYS=90
ABANDONED_WEBHOOK_RETENTION_DAYS=7
SESSION_REVOCATION_RETENTION_DAYS=400
```

Expired OAuth nonces and rate-limit rows are removed immediately during cleanup. Completed and abandoned webhook rows follow their configured windows. Session-revocation markers remain long enough to cover the maximum session lifetime and incident-response window.

Finance state and learning profiles do not expire automatically. The user can reset finance data separately or permanently delete the account from **Daten & Backup**. Permanent deletion:

- revokes existing sessions first;
- deletes provider connections and OAuth state;
- deletes encrypted finance state and budget-learning profiles;
- removes passkeys and the auth profile;
- clears the account-bound local vault from the requesting device.

Run a deletion acceptance test in staging and verify no user-bound rows remain. Do not log the user identifier or deleted financial content in the evidence.

## 7. Backup and restore

The PostgreSQL dump is the primary backup. Backups must be access-controlled, checksummed and retained separately from the application host. Encryption keys must be recoverable through a different protected channel; losing them makes encrypted rows unreadable.

A valid restore drill includes:

1. successful `pg_dump`;
2. recorded checksum;
3. successful `pg_restore --list`;
4. restore into a disposable database;
5. migration-version verification;
6. representative auth, finance, provider and revocation row verification;
7. application readiness and one authenticated sync.

Perform a documented restore drill at least quarterly.

## 8. Runtime canaries

`.github/workflows/runtime-canaries.yml` runs weekly and can be dispatched with `require_all=true` for release acceptance.

- The Hugging Face canary sends only fixed health-check prompts and validates error rate and p95 latency.
- The GoCardless canary obtains an application token and lists German institutions; it creates no end-user consent and reads no accounts.
- The PayPal canary validates OAuth client credentials; it reads no transaction report.

Missing credentials produce explicit skipped evidence unless the manually enforced mode requires all canaries. Never treat a skipped canary as provider certification.

## 9. Incident response

For suspected credential, provider or host compromise:

1. Remove public traffic.
2. Preserve logs, metric snapshots and deployment metadata.
3. Revoke provider credentials and affected OAuth applications.
4. Revoke active sessions through the durable revocation registry.
5. Rotate `SESSION_SECRET` and provider secrets.
6. Rotate encryption keys only through a tested re-encryption process; replacing them directly makes existing data unreadable.
7. Rebuild from a trusted commit and clean host.
8. Restore a verified backup where appropriate.
9. Document scope, user impact, remediation and notification obligations.

## 10. Rollback

Keep previous web and connector images available. A rollback must not silently downgrade database or encrypted-payload formats. Verify the prior version against a restored copy of the current database before switching traffic. Record the rollback commit and re-run health, auth, cloud-sync and provider checks.

**Application rollback (bad release, unchanged schema).** Redeploy the previous web/connector images. No database action needed.

**Schema rollback (bad migration).** Every file in `server/migrations/` has a matching down-migration in `server/migrations/down/`. To undo migrations newer than a known-good version:

```sh
DATABASE_URL=... npm --prefix server run migrate:rollback -- <target-version>
```

This drops exactly the tables/columns the rolled-back migrations created and removes their `schema_migrations` rows, newest first; it refuses to proceed (leaving already-rolled-back versions rolled back) if any version being undone has no down-migration, rather than risk a partial, undefined schema state. This is a fast, targeted undo for a bad migration specifically — it does not replace restoring from backup as the primary disaster-recovery path (see §7), since a down-migration only reverses schema, not data written under the now-removed columns/tables.

## 11. Remaining external production gaps

Repository-controlled non-desktop readiness is machine-checked, but these external gates still require independent evidence:

- physical Android and iOS device matrices;
- permanent Android signing, Digital Asset Links and Play publication;
- live GoCardless certification and real-account reconciliation;
- PayPal partner approval where third-party accounts are required;
- production-token AI latency, failure and drift evidence;
- manual screen-reader, keyboard and contrast review;
- independent threat model, penetration test and privacy/legal review;
- managed dashboards, paging and production restore exercises.

See `docs/NON_DESKTOP_READINESS.md` and `docs/PRODUCTION-READINESS-GATES.md` for the scoring and evidence boundary.
