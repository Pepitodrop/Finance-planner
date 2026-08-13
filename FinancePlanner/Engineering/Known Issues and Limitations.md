# Known Issues and Limitations

Distinguishing real product gaps from unverified provider integrations (the latter are covered in more detail in [[Provider Status]]).

## Real, currently-open gaps (from `TODOS.md` "Infrastructure" / open items, still true as of bootstrap)

- **`VERSION` file is disconnected from actual versioning and doesn't match anything.** Found during `/document-release` (PR #131, 2026-08-11): the root `VERSION` file reads `0.1.1.0`, `package.json` reads `0.2.0`, `server/package.json` reads `0.1.0`, and `CHANGELOG.md`'s latest tagged entry is `[0.3.0]` — four different numbers, none matching. No script or GitHub Actions workflow reads `VERSION` at all (`grep`-confirmed empty across `scripts/*.mjs` and `.github/workflows/*.yml`), so it isn't wired into any real release process; it's likely a vestigial file from an earlier/different tooling setup. Pre-existing on `main`, unrelated to PR #131's own changes (confirmed via `git diff origin/main...HEAD -- VERSION`, empty) — left untouched rather than guessing at a "correct" number without a clear source of truth; whoever owns actual releases should reconcile or remove it.

- **COBOL tests need the GnuCOBOL runtime locally.** 4 tests in `server/test/cobol-engine.test.js` fail in sandboxes lacking the GnuCOBOL runtime. Re-verified fresh during `/ship` (PR #131, 2026-08-11): the compiled binary (`build/transaction-rules`) is present in this sandbox, but invoking it fails with `error while loading shared libraries: libcob.so.4: cannot open shared object file` — a missing shared-runtime-library failure, not a missing-binary/`ENOENT` failure as previously recorded here. CI installs the full GnuCOBOL toolchain (runtime included) and its `cobol` check passes — independently re-confirmed green at HEAD `c7272c0a6301b73b61935cf15c71e7baa4aa9de5` during this same `/ship` phase. Real gap for any dev sandbox lacking `apt-get`/root to install `libcob`. See [[COBOL Domain Core]].
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

Related: [[Provider Status]], [[COBOL Domain Core]], [[Rejected Approaches]], [[COBOL Sandbox Limitation]], [[Rate Limiting]]
