# Personal launch runbook — 1 August 2026

This runbook prepares Finance Planner for a single-user personal pilot. It does not claim public multi-tenant production certification.

## Before launch

1. Deploy the current `main` build behind HTTPS.
2. Configure `DATABASE_URL`, a randomly generated `SESSION_SECRET` of at least 32 characters, and `HF_TOKEN` in the deployment secret store. Never commit them.
3. Run `npm ci`, `npm test`, `npm run build`, and `npm run verify:launch:runtime` in the deployed environment.
4. Confirm that database backups are enabled and perform one restore test.
5. Sign in, enable external AI consent explicitly, and verify that deterministic fallback remains available when the provider is unavailable.
6. Import only the accounts and transactions needed for the personal pilot. Start with read-only bank access where supported.

## Launch-day acceptance test

- Create and edit a manual transaction.
- Confirm dashboard totals and category calculations.
- Run one German and one English AI analysis.
- Confirm that every proposed financial action requires explicit approval.
- Remove or invalidate `HF_TOKEN` temporarily and confirm deterministic fallback.
- Confirm that telemetry contains only aggregate allowlisted fields and no prompts, descriptions, account identifiers, IBANs, or credentials.
- Record the observed hosted p95 latency and provider errors. Do not keep external AI enabled if p95 latency exceeds 12 seconds, safe abstention falls below 100%, or the provider is unreliable.

## First seven days

Review incorrect signals daily and label them only with aggregate correctness metadata. After at least 20 real personal-pilot observations, compare precision, recall, safe abstention, calibration, and latency against `ai/evaluation/personal-launch-baseline.json`.

Disable external AI and continue with deterministic analysis if:

- an unsafe action is suggested without approval;
- sensitive data appears in telemetry;
- precision or recall drops by more than 0.05;
- calibration error rises by more than 0.05;
- p95 latency increases by more than 50%;
- the Hugging Face revision, licence, or provider routing changes unexpectedly.

## Scope boundary

The 1 August launch is suitable for Luis's own controlled use after the runtime checks pass. Public release, use by other people, automated money movement, or financial-advice positioning still requires bank-provider certification, independent security and privacy review, production observability, and platform-specific release validation.
