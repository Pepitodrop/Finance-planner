# TODOS

## Infrastructure

### Install GnuCOBOL in CI/dev sandboxes so the COBOL engine tests actually run

**What:** 4 tests in `server/test/cobol-engine.test.js` fail with `Authoritative COBOL finance engine unavailable: spawn build/transaction-rules ENOENT` because GnuCOBOL is not installed and `build/transaction-rules` was never compiled.

**Why:** These tests cover the authoritative deterministic finance engine (signed amount normalization, balance updates, savings projections) — the one part of this app explicitly designed to never be probabilistic. Right now they silently don't run in this sandbox, so a real regression in the COBOL engine could ship undetected.

**Context:** Confirmed pre-existing via `git stash` during the `release-hardening` branch's `/ship` run on 2026-07-29 — same 4 failures on `main` before any of that branch's commits. README.md already lists GnuCOBOL as "optional ... for direct COBOL compilation" for local dev, but `.github/workflows/ci.yml` does install it and compile the binary for CI, so this is very likely CI-clean already — the gap is specifically sandboxes/containers (like this one) that don't have `apt-get`/root access to install `gnucobol`. Fix: either document that these 4 tests require `sudo apt-get install -y gnucobol && mkdir -p build && cobc -Wall -Wextra -x -o build/transaction-rules core/cobol/transaction_rules.cob` first, or make `cobol-engine.js` skip/mark-pending gracefully when the binary is missing instead of failing loudly (trade-off: could mask a real CI misconfiguration, so verify CI still compiles it first before softening the local behavior).

**Effort:** S
**Priority:** P0
**Depends on:** None

### Code-split the web bundle

**What:** `npx vite build` emits a single 992 kB (271 kB gzip) JS chunk and warns that
some chunks exceed the 500 kB guidance. All routes/tabs (dashboard, transactions,
connections, AI panel, assistant, data tools) and `recharts` currently ship in one
bundle loaded before first paint.

**Why:** Slower initial load on constrained mobile connections, directly relevant to the
web/mobile performance requirements (route-level code splitting, lazy loading, defensible
performance budgets enforced in CI). Not a correctness bug, so it was left out of this
hardening pass to avoid a risky wide-reaching refactor under time pressure.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Upgrade vitest off the vulnerable bundled esbuild/vite dev toolchain

**What:** `npm audit --include=dev` reports 5 vulnerabilities (3 moderate, 1 high, 1
critical) entirely inside `vitest@2.1.9`'s own bundled `vite`/`esbuild`/`vite-node`
(dev-server request-forgery class issues, GHSA-67mh-4wv8-2f99 and related). None affect
production dependencies (`npm audit --omit=dev` is clean) or the built app served to
users — the risk is confined to a developer's local `vite`/`vitest` dev server. Fixing
requires `vitest@4.x`, a breaking major-version jump not attempted here to avoid
destabilizing the test suite during a hardening pass.

**Effort:** M
**Priority:** P3
**Depends on:** None

### Server-side full GDPR-style data export

**What:** Account *deletion* is complete end-to-end (`server/src/account-deletion.js`,
`DELETE /api/auth/account`), but data *export* is client-side-only: `src/backup.ts`
exports whatever `AppState` is already loaded in the browser (finance data), not
everything the server holds (e.g. session-revocation records, connector metadata).

**Why:** Real privacy gap, but it's new feature surface (a new authenticated endpoint,
a full server-side data inventory, tests) rather than a hardening fix to an existing
mechanism — better scoped as its own follow-up than bundled into a hardening pass.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Wire a real Alertmanager paging receiver

**What:** `ops/monitoring/alertmanager.yml` ships only a stub `default` receiver — the
alert rules in `ops/monitoring/alerts.yml` are real and will fire, but into nothing.

**Why:** This genuinely needs an operator's real Slack/PagerDuty/webhook destination,
which doesn't exist in this repository — there's nothing to "fix" here without
fabricating a fake destination. Left for whoever owns the actual production deployment
to wire up one secret/URL.

**Effort:** S (for the operator, once they have a real destination)
**Priority:** P1
**Depends on:** an operator-provided paging destination (external)

## Completed

### Prevent user enumeration via the passkey authentication-options endpoint

Fixed 2026-08-02. `POST /api/auth/passkeys/authenticate/options` now always returns a
real, generated challenge with HTTP 200 regardless of whether the email matches a known
account, instead of throwing (and leaking account existence) for unregistered emails.
Covered by `server/test/auth-router.test.js`.

### Fix moderate-severity uuid buffer-bounds CVE in a production backend dependency

Fixed 2026-08-02. `npm audit --omit=dev` flagged GHSA-w5hq-g745-h8pq (CVSS 7.5, missing
buffer bounds check in `uuid` <11.1.1) pulled in transitively through
`google-auth-library@9.15.1` → `gaxios@6.7.1` → `uuid@9.0.1`. Bumped
`server/package.json` to `google-auth-library@^10.9.1` (drops the vulnerable `gaxios`
major and its `uuid` dependency entirely); `npm audit --omit=dev` is now clean. Added a
regression test exercising the real `OAuth2Client.generateAuthUrl()` call on
`GET /api/auth/google/start` since this route previously had no test coverage at all.

### Add automated accessibility testing for the primary application shell

Fixed 2026-08-02. The repo had `@testing-library/react`/`jest-dom` installed but unusable
(no `jsdom` environment wired into `vitest.config.ts`), and zero component-level or
accessibility tests existed anywhere in the repo. Added `jsdom` + `axe-core` +
`@testing-library/user-event`, scoped the `jsdom` environment to `*.test.tsx` files only
(`environmentMatchGlobs`) so existing Node-environment `.test.ts` files were unaffected,
and added `src/appAccessibility.test.tsx`, which renders the real composed app shell
(`WebMobileHardening` + `FrontendExperience` + `NavigationAccessibility` + `App`, matching
`bootstrap.tsx`'s actual composition, with a seeded authenticated/unlocked storage state
so `App` mounts the same way it does after real sign-in) and asserts: zero axe WCAG
2.1/2.2 A/AA violations on the dashboard and on the open transaction dialog, the skip link
moves focus into `#main-content`, exactly one sidebar nav item carries `aria-current="page"`
and only after activation, and the transaction dialog traps focus, closes on Escape, and
restores focus to its trigger. This is jsdom-based unit-level coverage, not
real-browser/cross-browser Playwright testing — the `playwrightAndAccessibility` readiness
gate is marked `partial`, not `verified`, for that reason.

Writing this test caught two real, currently-shipped accessibility regressions, both fixed
in the same pass:
- **Duplicate skip link.** `App.tsx` rendered its own inline `<a className="skip-link"
  href="#main-content">`, duplicating the one `WebMobileHardening.tsx` already renders
  globally (which also carries the real `onClick` focus-management logic). A keyboard user
  hit two identical "Zum Hauptinhalt springen" links before reaching content. Removed the
  redundant one from `App.tsx`.
- **Broken focus restoration on dialog close.** The transaction dialog's description input
  had a native `autoFocus`. React applies `autoFocus` synchronously during commit, before
  `FrontendExperience.tsx`'s `MutationObserver`-based `enhanceModal` gets a chance to run —
  so `enhanceModal` captured the dialog's own (just-autofocused) input as `previousFocus`
  instead of the "Manuelle Buchung" trigger button that actually opened the dialog. On
  close, focus tried to return to a node that no longer existed and silently fell back to
  `<body>`, stranding keyboard/screen-reader users. Removed the conflicting `autoFocus`;
  `FrontendExperience`'s existing initial-focus and restore-on-close logic (which the new
  test now covers) handles it correctly on its own.

`config/non-desktop-readiness.json`'s `frontend/accessibility` gate previously matched the
skip-link string against `src/App.tsx` specifically; updated its evidence to point at
`src/WebMobileHardening.tsx` (where the skip link now uniquely lives) and added
`src/appAccessibility.test.tsx` as additional evidence for that gate.

### Harden the production nginx config: add HSTS, drop dev-only CSP entries

Fixed 2026-08-03. `deploy/nginx.conf` — the actual production edge server image, not used
by local dev (`vite dev` has its own proxy config) — never sent `Strict-Transport-Security`
even though `server.js` does, and hardcoded `http://localhost:*`/`ws://localhost:*` into
the production CSP `connect-src` for no reason. Added the HSTS header (unconditional, since
SECURITY.md already mandates HTTPS-only production deployments) and removed the localhost
entries. Added a regression guard in `scripts/verify-mobile.mjs` asserting the header is
present and `localhost` never appears in the file again.

### Correct the stale `distributedRateLimiting` production-readiness gate

Fixed 2026-08-03. `config/production-readiness-evidence.json` marked `distributedRateLimiting`
as `pending` with no evidence, but `server/src/distributed-rate-limiter.js` already
implements it (Postgres-backed sliding-window limiter) and `server/src/server.js` already
enforces it in public production (`requireDistributed` throws if `CONNECTOR_STORE_DRIVER`
isn't `postgres`), with a real passing test (`server/src/distributed-rate-limiter.test.js`).
Updated the gate to `partial` (not `verified` — that status requires a named, accountable
human `approvedBy`/`reviewedAt`, which no one has actually recorded; claiming it here would
trade one inaccuracy for another) citing the implementation, its test, and the enforcement
site as evidence. No code change — this was a documentation-accuracy fix, and leaving it
`pending` was itself understating real, tested readiness.

### Scan built Docker images for known vulnerabilities in CI

Fixed 2026-08-03. `.github/workflows/ci.yml`'s `containers` job built and compose-validated
`Dockerfile.web`/`Dockerfile.server` but never scanned the resulting images — base-image
CVEs could ship undetected between dependabot's monthly image-tag bumps. Added
`aquasecurity/trivy-action`, pinned by commit SHA (not a mutable tag) to the `v0.36.0`
release, scanning both images and failing the job on HIGH/CRITICAL findings.
**Pinned by SHA specifically because this action itself was compromised in a March 2026
supply-chain attack that affected every tag from `0.0.1` through `0.34.2`** — using any tag
in that range, or trusting a floating tag going forward, would have introduced exactly the
kind of vulnerability this step exists to catch. Only verifiable by an actual CI run (no
Docker/Trivy available in this sandbox); the workflow YAML was validated for correctness
with `js-yaml`.

### Make schema migrations reversible

Fixed 2026-08-03. `server/migrations/*.sql` were forward-only; the only rollback story was
"restore a database backup" (`docs/PRODUCTION.md` §10), with no in-place undo for a bad
migration specifically. Added a matching down-migration in `server/migrations/down/` for
every existing forward migration, a `rollbackDatabase(pool, targetVersion)` function in
`server/src/database.js` (same advisory-lock pattern as the existing forward `migrateDatabase`;
refuses a partial rollback if any version being undone has no down-migration file, rather
than risk an undefined schema state), and a CLI entry point
(`npm --prefix server run migrate:rollback -- <target-version>`, `server/src/migrate-rollback.js`).

Tests (`server/test/migrate-rollback.test.js`): one static, always-running check that every
forward migration has a matching down-migration file (catches drift as new migrations are
added, no database required); three Postgres-dependent tests (skipped without
`TEST_DATABASE_URL`/`DATABASE_URL`, same convention as the existing Postgres test suite)
that round-trip forward→rollback→forward, confirm a rollback stops exactly at its target
without touching older versions, and confirm the fail-closed behavior on a missing
down-migration. These deliberately exercise the mechanism against synthetic, temp-directory
migrations with uniquely-named scratch tables rather than the real schema — other test files
run concurrently against the same test database and depend on the real tables existing, so
rolling back the real schema from within a test would risk dropping tables out from under
them. Updated `docs/PRODUCTION.md` §10 to document the new rollback command alongside the
existing backup-restore path (rollback is a faster, targeted undo for a bad migration; it
doesn't replace backups as the primary disaster-recovery mechanism, since a down-migration
reverses schema, not data already written under the removed columns/tables).

