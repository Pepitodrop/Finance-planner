# Known Issues and Limitations

Distinguishing real product gaps from unverified provider integrations (the latter are covered in more detail in [[Provider Status]]).

## Real, currently-open gaps (from `TODOS.md` "Infrastructure" / open items, still true as of bootstrap)

- **COBOL tests need GnuCOBOL locally.** 4 tests in `server/test/cobol-engine.test.js` fail with `ENOENT` in sandboxes without GnuCOBOL installed/compiled — CI compiles it, so this is believed CI-clean, but it's a real gap for any dev sandbox lacking `apt-get`/root. See [[COBOL Domain Core]].
- **Single JS bundle, no code-splitting.** ~992 kB (271 kB gzip) single chunk; all routes ship before first paint. Deferred as a risky wide refactor, not attempted opportunistically.
- **`vitest@2.1.9`'s bundled dev toolchain has known CVEs** (dev-server only; `npm audit --omit=dev` is clean). Needs a `vitest@4.x` major bump, not yet done.
- **No server-side full data export.** Account deletion is complete; data export (`src/backup.ts`) is client-side-only and only covers loaded `AppState`, not server-only records (session revocations, connector metadata). Scoped as a future feature, not a hardening fix.
- **Alertmanager has no real paging receiver.** `ops/monitoring/alertmanager.yml` ships only a stub; alert rules are real and will fire into nothing until an operator wires a real destination.

## Product-level gaps stated in README ("Remaining production gaps")

- representative Playwright, accessibility, load and physical-device test matrices
- independent threat model, penetration test and privacy review
- formal data-retention, account-deletion and recovery workflows (deletion itself is implemented; the surrounding formal workflow documentation is not)
- managed monitoring, tracing, SLOs and paging
- live GoCardless/PayPal certification and reconciliation testing
- safe multi-instance coordination for the encrypted whole-document auth store
- permanent Android release key, verified Digital Asset Links and Play Store publication
- native iOS and signed desktop packages
- representative AI quality, latency, drift and safety benchmarks

## Not a product gap — a testing-evidence gap

Several CI workflows are **credential-gated and non-blocking by default** (`hosted-ai-acceptance.yml`'s `require_live_ai`, `runtime-canaries.yml`'s `require_all`, `production-operations.yml`'s `require_live_bank`). A fully green CI run does **not** by itself prove GoCardless, PayPal, hosted HF inference, or Google OAuth work end-to-end in production — that evidence is deliberately deferred to a manual, human-recorded process (`docs/issue-105-live-verification.md`). Don't conflate "CI is green" with "the integration is live-verified." See [[Provider Status]].

Related: [[Provider Status]], [[COBOL Domain Core]], [[Rejected Approaches]]
