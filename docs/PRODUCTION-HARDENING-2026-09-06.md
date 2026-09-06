# Production hardening review — 2026-09-06

## Outcome

The default branch is a production-oriented personal MVP, but it is not yet eligible for
an unconditional "production ready" declaration under its own strict release policy.
Core builds, static analysis, production dependency audits, and the broad automated test
suite are healthy after the fixes in this review. The remaining release gates require
real provider accounts, physical devices, deployment access, signing identities, paging
destinations, and independent reviewers.

The public deployment responded over HTTPS with HSTS, CSP, clickjacking protection,
no-sniff, and no-store HTML caching. At review time its HTML referenced an older build
last modified on 2026-08-22, so deployment of the current default branch and a post-deploy
acceptance run remain mandatory.

## Completed in this review

1. **P1 — Google Subscriptions PostgreSQL persistence:** added migration 010 so the
   shared connector and OAuth provider constraints accept `google-subscriptions`, plus a
   matching rollback and regression tests.
2. **P1 — release suite reliability:** updated source-boundary tests after the callback
   replay-safety and factory-reset implementations evolved, without weakening the
   security assertions.
3. **P2 — application-shell and layout test reliability:** isolated the intentional
   one-shot logout behavior and made the Firefox connection-dialog CSS regression test
   load the exact production styles it verifies.

## Verified locally

- `npm run lint`: passed.
- `npm run build`: passed (TypeScript and Vite production build).
- Frontend production dependency audit: zero vulnerabilities.
- Server production dependency audit: zero vulnerabilities.
- Frontend suite: 574 tests pass after the corrections; subsequent verification scripts
  are governed by the readiness manifest.
- Server suite: 448 non-COBOL tests pass or skip only when their documented external
  PostgreSQL/runtime prerequisites are absent. The four authoritative COBOL tests require
  a compiled `build/transaction-rules`; CI installs GnuCOBOL and compiles it, while this
  review environment did not permit package installation.

## Remaining prioritized gates

### P0 — release and deployment acceptance

- Deploy the current default-branch images to `finance.luisbenedikt.de`.
- Run `production-acceptance.yml`, live deployment smoke checks, database migration 010,
  backup/restore verification, and rollback rehearsal against the deployment.
- Record accountable approval evidence in `config/production-readiness-evidence.json`;
  do not mark gates verified based only on code presence.

### P1 — operational and independent assurance

- Configure a real Alertmanager receiver and verify a test page reaches the operator.
- Complete independent security and privacy reviews and close or formally accept findings.
- Complete real-browser Playwright coverage and manual keyboard/assistive-technology QA.

### P1 — provider and device evidence

- Certify GoCardless, Enable Banking, PayPal, and Google Subscriptions against sandbox and
  live accounts, including disconnect, replay, outage, pagination, and reconciliation.
- Validate Android and iOS behavior on physical devices; configure permanent Android
  signing and Digital Asset Links before distribution.

### P2 — known product and architecture work

- Preserve and retry provider revocation when a disconnect cannot be confirmed.
- Prevent an in-flight connector callback from resurrecting a concurrently disconnected
  connection.
- Implement genuine per-merchant PayPal partner authorization, or keep partner mode
  disabled/fail-closed.
- Add a server-side complete data export.
- Code-split the approximately 971 kB JavaScript bundle (about 269 kB gzip).

### P3 — maintenance

- Upgrade Vitest and its development-only Vite/esbuild chain after compatibility testing.
- Verify Enable Banking ASPSP identifier length against a real provider directory before
  changing the shared limit.
- Produce signed desktop packages only if desktop distribution becomes an actual target.

The detailed standing backlog remains in `TODOS.md`; evidence requirements and the
machine-enforced policy remain in `docs/PRODUCTION-READINESS-GATES.md`.
