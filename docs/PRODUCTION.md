# Production operations runbook

This runbook defines the minimum deployment and operating standard for Finance Planner. It is intentionally stricter than the local-development setup.

## 1. Deployment model

The supported baseline is one web container and one connector container on a single trusted host. Place a TLS-terminating reverse proxy or managed load balancer in front of the web service. Keep the connector port bound to loopback and route `/api` traffic internally.

Do not run multiple connector replicas against the file-backed encrypted store. Horizontal scaling requires a shared transactional database and distributed coordination.

## 2. Required production configuration

Copy `.env.example` to a deployment-specific secret source. For a public deployment:

```dotenv
APP_ORIGIN=https://finance.example.com
AUTH_MODE=<configured-production-mode>
PUBLIC_DEPLOYMENT=true
SESSION_SECRET=<independent-random-secret>
CONNECTOR_MASTER_KEY=<independent-random-secret>
PAYPAL_ENVIRONMENT=live
```

Generate each secret independently with at least 256 bits of entropy. Store secrets in the platform secret manager. Never bake them into an image, commit them, or print them in logs.

## 3. Pre-deployment gate

Before every production release:

1. Confirm CI succeeded for the exact commit.
2. Build images from a clean checkout.
3. Run production dependency and container vulnerability scans.
4. Validate the Compose configuration with production environment values.
5. Back up the connector data volume.
6. Confirm the restore procedure using a disposable environment.
7. Verify OAuth callback URLs and provider environments.
8. Verify HTTPS, security headers, CORS, and authentication behavior.
9. Record the deployed commit and rollback image tags.

## 4. Start and verify

```bash
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:${CONNECTOR_PORT:-8787}/health/ready
curl --fail http://127.0.0.1:${WEB_PORT:-8080}/healthz
```

The connector is ready only when `/health/ready` returns HTTP 200. Do not route traffic before both service health checks pass.

## 5. Backup and restore

The encrypted store remains sensitive even though it is encrypted. Backups must be access-controlled, integrity-protected, and retained separately from the application host. The encryption key must be backed up independently; losing it makes the store unrecoverable.

Create a backup:

```bash
bash scripts/backup-connector-data.sh
```

Restore only during a maintenance window:

```bash
bash scripts/restore-connector-data.sh backups/<archive>.tar.gz
```

After restoration, start the connector and verify `/health/ready`, authentication, and one provider synchronization. Perform a scheduled restore drill at least quarterly.

## 6. Monitoring and alerting

Collect container stdout/stderr centrally. Alert on:

- connector readiness failures
- restart loops
- HTTP 5xx rate increases
- authentication failures above the normal baseline
- rate-limit saturation
- provider synchronization failures
- disk usage and backup age
- certificate expiry

Logs must not contain session cookies, provider tokens, encryption keys, full financial records, or request bodies.

## 7. Incident response

For a suspected credential or host compromise:

1. Remove public traffic.
2. Preserve relevant logs and deployment metadata.
3. Rotate `SESSION_SECRET`, provider credentials, and affected OAuth applications.
4. Rotate `CONNECTOR_MASTER_KEY` only through a tested data re-encryption process; replacing it without migration makes existing data unreadable.
5. Rebuild from a trusted commit and clean host.
6. Restore a verified backup where appropriate.
7. Document scope, user impact, and corrective actions.

## 8. Rollback

Keep the previous web and connector images available. Application rollback must not silently downgrade the encrypted-store format. Before rollback, verify that the previous version can read the current data format. If compatibility is uncertain, restore the pre-deployment backup in a disposable environment first.

## 9. Remaining production gaps

The largest architectural gaps are:

- transactional shared database and migrations
- distributed rate limiting and multi-instance coordination
- managed identity/session infrastructure
- full end-to-end browser and real-device test matrix
- native iOS, Android, Windows, macOS, and Linux packaging
- formal threat model, penetration test, and privacy/legal review
- SLOs, dashboards, paging, and automated disaster-recovery exercises
