# Security (Production Posture)

See [[Security Decisions]] for the individual decision records with rationale — this note is the operational-posture summary.

## Stated security boundaries (`README.md`)

- financial API routes require an authenticated session
- cloud documents are isolated by session user ID
- finance and auth documents are encrypted before database storage
- provider credentials remain server-side and encrypted
- raw bank credentials and provider tokens never enter the finance state document
- state input is independently validated on client and server
- transactions must reference an existing account
- monetary values are safe integer cents
- conflicting device writes fail closed
- AI suggestions remain approval-gated
- the Android shell uses HTTPS, requests only internet access, disables Android backup

**Explicit disclaimer (README):** "This repository has not completed an independent penetration test or formal privacy assessment. Do not use it as the sole unrecoverable record of important financial information." Treat this as still true unless a dated, evidenced update says otherwise.

## Required production secrets (`docs/PRODUCTION.md`)

`SESSION_SECRET`, `CONNECTOR_MASTER_KEY`, `AUTH_MASTER_KEY`, `METRICS_TOKEN` — each generated independently with ≥256 bits of entropy, stored in a platform secret manager, never baked into images/commits/logs. Losing `CONNECTOR_MASTER_KEY` makes finance/provider payloads unrecoverable; losing `AUTH_MASTER_KEY` makes the auth store unrecoverable.

## Backup validity (`README.md`, `docs/DATABASE.md`)

A backup is only considered valid after: `pg_dump` succeeds → checksum recorded → `pg_restore --list` succeeds → restored into a disposable database → schema and representative rows verified. Store dumps separately from the encryption keys, while ensuring both remain recoverable together for an authorized disaster-recovery operation.

## Container hardening

Read-only root filesystem, dropped Linux capabilities, connector bound to loopback only (see [[Deployment]]).

## Supply chain

Third-party GitHub Actions pinned by commit SHA where compromise history exists (Trivy action — see [[Security Decisions]] for the specific 2026 incident that motivated this).

Related: [[Security Decisions]], [[Deployment]], [[Provider Status]]
