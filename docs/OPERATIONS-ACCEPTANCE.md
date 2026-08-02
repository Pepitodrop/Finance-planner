# Production operations acceptance

This repository now provides repeatable evidence for three release workstreams: live-bank acceptance, encrypted PostgreSQL backup/restore drills, and managed monitoring configuration.

## Live bank acceptance

Run the `Production operations acceptance` workflow manually with these protected repository secrets:

- `ACCEPTANCE_CONNECTOR_URL`
- `ACCEPTANCE_BEARER_TOKEN`
- `ACCEPTANCE_CONNECTION_ID`

Set `require_live_bank=true` for release acceptance. The harness checks connector readiness, reads the selected consented connection, performs a real synchronization, verifies the post-sync state, and writes redacted evidence. It never stores credentials or raw transaction bodies.

This harness is objective evidence for one specifically approved test connection. It does not replace GoCardless contractual approval, bank-specific certification, or manual statement reconciliation. Those must be attached to the release record.

## Encrypted backups and restore drills

`ops/backup/postgres-backup.sh` creates a PostgreSQL custom-format dump, validates its catalogue, encrypts it with AES-256-CBC/PBKDF2, writes a SHA-256 checksum, and applies retention.

`ops/backup/restore-drill.sh` verifies the checksum, decrypts the dump into a temporary directory, restores it into a disposable database, and emits `artifacts/restore-drill.json`.

The weekly workflow runs a complete disposable backup/restore drill. Production deployment must additionally schedule the backup script, copy encrypted backups off-host, protect the encryption key through a separate secret-management channel, and monitor backup age.

## Monitoring

Start the monitoring overlay with:

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

Before starting it, place the exact `METRICS_TOKEN` value in `secrets/metrics_token` with restrictive permissions. Prometheus scrapes the authenticated connector metrics endpoint and loads the alert rules in `ops/monitoring/alerts.yml`.

The bundled Alertmanager receiver is deliberately empty. Configure a protected PagerDuty, Opsgenie, email, Slack, or webhook receiver in the deployment configuration before routing production traffic. Expose Prometheus and Alertmanager only through private administration access.

## Release evidence

A production release is blocked unless:

1. the exact commit has green standard CI, browser acceptance, and production-operations acceptance;
2. the live-bank workflow passes with `require_live_bank=true` for an approved real test connection;
3. the latest encrypted off-host backup and restore drill are documented;
4. Prometheus is scraping successfully and an end-to-end test alert reaches the accountable on-call destination;
5. provider approval and manual statement reconciliation evidence are attached outside the repository.
