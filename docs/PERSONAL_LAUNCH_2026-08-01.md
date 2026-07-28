# Personal launch runbook — 1 August 2026

This runbook prepares Finance Planner for a single-user personal pilot. It does not claim public multi-tenant production certification.

## Before launch

1. Deploy the current `main` build behind HTTPS with external AI disabled.
2. Configure `DATABASE_URL`, a randomly generated `SESSION_SECRET` of at least 32 diverse characters, and `HF_TOKEN` in the deployment secret store. Never commit them.
3. Run `npm ci`, `npm test`, and `npm run build`.
4. Keep `EXTERNAL_AI_ENABLED` unset or set to `false`, then run `npm run verify:launch:runtime` in the deployed environment.
5. Confirm that `.launch-evidence/hosted-ai.json` exists, records the immutable model revision, has five successful hosted samples, a 0% provider error rate, p95 latency of at most 12 seconds, and `externalAiMayBeEnabled: true`.
6. Only after that evidence exists, enable external AI in the deployment and require explicit in-app consent. If the runtime command fails, leave external AI disabled and use deterministic analysis.
7. Confirm that database backups are enabled and perform one restore test.
8. Import only the accounts and transactions needed for the personal pilot. Start with read-only bank access where supported.

## Launch-day acceptance test

- Create and edit a manual transaction.
- Confirm dashboard totals and category calculations.
- Run one German and one English AI analysis.
- Confirm that every proposed financial action requires explicit approval.
- Remove or invalidate `HF_TOKEN` temporarily and confirm deterministic fallback.
- Confirm that telemetry contains only aggregate allowlisted fields and no prompts, descriptions, account identifiers, IBANs, credentials, or tokens.
- Re-run `npm run verify:launch:runtime` after any model revision, provider route, deployment region, or infrastructure change.

## First seven days

Review incorrect signals daily and label them only with aggregate correctness metadata. After at least 20 real personal-pilot observations, compare precision, recall, safe abstention, calibration, and latency against `ai/evaluation/personal-launch-baseline.json`.

Disable external AI and continue with deterministic analysis if:

- an unsafe action is suggested without approval;
- sensitive data appears in telemetry;
- precision or recall drops by more than 0.05;
- calibration error rises by more than 0.05;
- p95 latency increases by more than 50%;
- any hosted validation sample fails;
- the Hugging Face revision, licence, or provider routing changes unexpectedly.

## Scope boundary

The 1 August launch is suitable for Luis's own controlled use only after the static checks, live hosted-provider gate, backup restore test, and acceptance test all pass. Public release, use by other people, automated money movement, or financial-advice positioning still requires bank-provider certification, independent security and privacy review, production observability, and platform-specific release validation.