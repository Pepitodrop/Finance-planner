# Provider Status

Strict, evidence-based status per external integration. "Code exists" is never treated as "verified working." See [[Memory System]] for source-of-truth precedence — re-check this note against current code/CI before relying on it for a release decision.

## Runtime-evidence rule

A workflow definition proves that a runtime check **can** be executed; it does not prove that a provider was successfully exercised. For external/provider/device-dependent integrations, any `Runtime verified` value other than `no`, `unknown`, or `n/a` must cite concrete dated execution evidence such as a successful GitHub Actions run and retained artifact/result. If no such execution evidence is pinned, keep the integration unverified rather than inferring success from workflow existence or unit tests.

For first-party internal flows with no external provider (for example Finance Planner email/password authentication), a local production-style runtime exercise may be recorded when the environment and real endpoints/storage used are stated explicitly. It must be labeled **local production-style runtime verified**, never simply "runtime verified," and it remains separate from **production-deployment verified** until the deployed production host is exercised.

---

## GoCardless (bank data, PSD2 AISP)

Implementation: **implemented** (real GoCardless Bank Account Data API client, `server/src/providers.js` `GoCardlessProvider`)
Configuration: **optional** (requires `GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`)
Provider-dependent: yes
Runtime verified: **no dated successful canary artifact pinned** — `.github/workflows/runtime-canaries.yml` can check token creation and institution-list access when credentials exist, but the workflow definition itself is not execution evidence
Production verified: **no evidence found**
Last evidence: **evidence checked 2026-08-09** — no specific successful `external-runtime-canaries` run/artifact is recorded here; no completed end-to-end consent→sync→disconnect cycle is evidenced in-repo, and `docs/issue-105-live-verification.md` requires this as a manual, human-recorded step
Current limitations: README lists "live GoCardless... certification and reconciliation testing" as outstanding; `docs/bank-connection-production.md` states passing unit tests explicitly does not substitute for deployment/sandbox evidence
Relevant code/docs: `server/src/providers.js`, `.github/workflows/runtime-canaries.yml`, `scripts/provider-runtime-canary.mjs`, `docs/OPEN_BANKING_ARCHITECTURE.md`, `docs/issue-105-provider-setup.md`, `docs/issue-105-live-verification.md`, `docs/bank-connection-production.md`, `docs/bank-production-runbook.md`

---

## PayPal

Implementation: **implemented** (real PayPal REST client, owner + partner modes, `server/src/providers.js` `PayPalProvider`)
Configuration: **optional** (requires `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`; owner mode also requires `PAYPAL_OWNER_USER_ID`; partner mode also requires `PAYPAL_PARTNER_MERCHANT_ID`)
Provider-dependent: yes
Runtime verified: **no dated successful canary artifact pinned** — `.github/workflows/runtime-canaries.yml` can check client-credential token access when credentials exist, but the workflow definition itself is not execution evidence
Production verified: **no evidence found**
Last evidence: **evidence checked 2026-08-09** — no specific successful `external-runtime-canaries` run/artifact is recorded here; no completed sandbox redirect→sync→disconnect cycle is evidenced in-repo, and `docs/issue-105-live-verification.md` requires manual human verification
Current limitations: owner mode is explicitly documented as *not* equivalent to third-party user authorization; README lists live PayPal certification as outstanding
Relevant code/docs: `server/src/providers.js`, `.github/workflows/runtime-canaries.yml`, `scripts/provider-runtime-canary.mjs`, `docs/OPEN_BANKING_ARCHITECTURE.md` ("PayPal modes"), `docs/issue-105-live-verification.md`

---

## finapi

Implementation: **absent** (explicit unavailable placeholder in the provider registry, `server/src/providers.js`)
Configuration: n/a
Provider-dependent: yes (by design, once implemented)
Runtime verified: n/a
Production verified: n/a
Current limitations: intentionally not implemented yet; exists as a registry slot so a real adapter can be added without touching COBOL banking-domain rules
Relevant code/docs: `docs/OPEN_BANKING_ARCHITECTURE.md`

---

## Email/password (sign-in, PR #131)

Implementation: **implemented** (`server/src/password-auth.js` scrypt hashing/verification, `server/src/auth-router.js` `/api/auth/password/register` + `/api/auth/password/login`, `src/AuthGate.tsx` UI)
Configuration: **always available** (no external credentials — server-side-only, no third-party dependency)
Provider-dependent: no
Runtime verified: **local production-style: yes; deployed production host: no** — `scripts/auth-security-production-acceptance.mjs` drives real registration and login through the actual endpoints against a Postgres-backed connector (not mocked); re-run locally 2026-08-09 against a fresh `postgres:17-bookworm` container + `vite build` + `vite preview`, matching `production-acceptance.yml`. Passed. This verifies the real application path in a production-like local environment, not `finance.luisbenedikt.de` or any other deployed production host.
Production verified: **no evidence found** — the acceptance run above is local/CI-equivalent, not a production deployment exercise
Current limitations: a user who registered via Google first cannot later add a password to the same account (register rejects an already-known email) — no password-add-later path exists yet; this is a UX gap, not a security or duplicate-identity bug (see [[Authentication]])
Relevant code/docs: `server/src/password-auth.js`, `server/src/auth-router.js`, `src/AuthGate.tsx`, `scripts/auth-security-production-acceptance.mjs`

---

## Google OAuth (sign-in)

Implementation: **implemented** (`server/src/auth-router.js`, `google-auth-library` `OAuth2Client`, state/nonce/ID-token verification)
Configuration: **optional** (requires `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`; Compose default `AUTH_MODE=google`)
Provider-dependent: yes
Runtime verified: **no evidence found** — no CI workflow performs a live Google OAuth handshake; CI's own production-acceptance browser suite runs under `AUTH_MODE=local`, not real Google auth
Production verified: **no evidence found**
Current limitations: `docs/issue-105-live-verification.md` explicitly defers live verification to a human-completed, human-recorded step
Relevant code/docs: `server/src/auth-router.js`, `server/src/runtime-security.js`, `docs/issue-105-live-verification.md`, `.github/workflows/production-acceptance.yml`

---

## WebAuthn / Passkeys

Implementation: **implemented** (`@simplewebauthn/server`, `server/src/auth-router.js`, resident-key + user-verification required; post-login enrollment in `src/AuthGate.tsx` via `@simplewebauthn/browser`)
Configuration: **configured** (no external credentials needed — relies on the browser/authenticator, not a third-party API)
Provider-dependent: no (standards-based, not a hosted provider) — but device/browser-dependent
Runtime verified: **no real-authenticator runtime evidence found** — unit-level compatibility coverage exists (`server/test/passkey-authenticator-compatibility.test.js`), but unit tests are not runtime evidence and do not exercise real authenticator hardware
Production verified: **no evidence found** — `docs/issue-105-live-verification.md` requires manual verification on Android, iOS and Windows over HTTPS with real hardware, explicitly not yet proven
Current limitations: enumeration-prevention fix landed 2026-08-02; physical-device matrix outstanding. The obsolete pre-redesign pre-auth passkey client (`src/passkeys.ts`) and its account-memory test were removed in PR #131; this does not remove the active post-login enrollment path.
Relevant code/docs: `server/src/auth-router.js`, `src/AuthGate.tsx`, `server/test/passkey-authenticator-compatibility.test.js`, `docs/issue-105-live-verification.md`

---

## Hosted AI (Hugging Face)

Implementation: **implemented** (`server/src/huggingFaceClient.js`, `ai-router.js`, `ai-ensemble.js`, consent-gated, revision-pinned, allowlisted)
Configuration: **optional** (requires `HF_TOKEN`; model/revision pinned via `ai/model-lock.json` + `HF_MODEL`/`HF_MODEL_REVISION`)
Provider-dependent: yes
Runtime verified: **no** — a concrete PR-linked evidence artifact exists, but it records a credential block rather than successful inference
Runtime evidence: GitHub Actions `Hosted AI acceptance` run **#81** (run id `31319731449`) on commit `6358c045fe55ac9f2088a887a9b517c10279505e`; artifact `hosted-ai-acceptance` (artifact id `9039803303`), created `2026-08-09T14:55:42Z`, digest `sha256:5f7fe0ed842f41dd1206fca15191230fae4fe6c811e7d87c258aa9214b144815`. Its `live-ai-acceptance.json` records `status: blocked_by_credentials`, `tokenConfigured: false`, and `liveVerification.verified: false` (`reason: live_acceptance_not_recorded`). This is evidence that the acceptance gate executed, **not** evidence that Hugging Face inference succeeded.
Production verified: **no evidence found** — `server/src/ai-capabilities.js` models "not verified" as its own default state (`liveVerification` defaults to `{ verified: false, reason: 'live_acceptance_not_recorded' }` unless `HF_LIVE_VERIFIED_AT` is explicitly set)
Current limitations: ordinary PR CI runs do not require a real successful hosted-inference call by default; `runtime-canaries.yml` skips rather than fails if `HF_TOKEN` is absent; hosted inference degrades to deterministic fallback on malformed/unavailable output by design
Relevant code/docs: `server/src/ai-capabilities.js`, `server/src/ai-ensemble.js`, `docs/HUGGINGFACE_AI.md`, `docs/AI_PRODUCTION.md`, `.github/workflows/hosted-ai-acceptance.yml`, `.github/workflows/runtime-canaries.yml`

---

## Local AI (Transformers.js / ONNX, browser-side)

Implementation: **implemented** (`src/aiModels.ts`, served from app origin, not a CDN)
Configuration: **configured** (no external account/credentials — models vendored/fetched from app origin)
Provider-dependent: no
Runtime verified: **unknown** — no explicit in-repo evidence of measured runtime behavior (load success rate, inference latency) across real browsers was found in this pass; `verify-ai.mjs` and related gate scripts run in CI but this report did not independently re-verify what exactly they assert
Production verified: **no evidence found**
Relevant code/docs: `src/aiModels.ts`, `README.md` ("AI architecture")

---

Related: [[Authentication]], [[Bank Connections]], [[PayPal]], [[AI System]], [[Known Issues and Limitations]], [[Rejected Approaches]]
