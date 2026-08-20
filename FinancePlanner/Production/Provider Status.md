# Provider Status

Strict, evidence-based status per external integration. "Code exists" is never treated as "verified working." See [[Memory System]] for source-of-truth precedence — re-check this note against current code/CI before relying on it for a release decision.

## Runtime-evidence rule

A workflow definition proves that a runtime check **can** be executed; it does not prove that a provider was successfully exercised. For external/provider/device-dependent integrations, any `Runtime verified` value other than `no`, `unknown`, or `n/a` must cite concrete dated execution evidence such as a successful GitHub Actions run and retained artifact/result. If no such execution evidence is pinned, keep the integration unverified rather than inferring success from workflow existence or unit tests.

For first-party internal flows with no external provider (for example Finance Planner email/password authentication), a local production-style runtime exercise may be recorded when the environment and real endpoints/storage used are stated explicitly. It must be labeled **local production-style runtime verified**, never simply "runtime verified," and it remains separate from **production-deployment verified** until the deployed production host is exercised.

---

## Enable Banking (bank data, AIS) — preferred provider

Implementation: **implemented** (real Enable Banking API client, `server/src/providers.js` `EnableBankingProvider`, `server/src/enable-banking-jwt.js`)
Configuration: **optional** (requires `ENABLE_BANKING_APPLICATION_ID` + `ENABLE_BANKING_PRIVATE_KEY_FILE` or `ENABLE_BANKING_PRIVATE_KEY`)
Provider-dependent: yes
Runtime verified: **no** — no dated execution evidence, no Enable Banking sandbox credentials configured anywhere in this environment
Production verified: **no evidence found**
Last evidence: **evidence checked 2026-08-20** — implementation added this session, verified against current official Enable Banking docs (`enablebanking.com/docs/api/quick-start/`, `/docs/api/reference/`) at implementation time, not from memory. Every server-side test mocks `fetch`; none has ever reached the real Enable Banking API.
Current limitations: same class of gap as GoCardless below — no completed end-to-end consent→sync→disconnect cycle evidenced against a live sandbox. Requires Control Panel setup (sandbox application, allowed callback URL `{APP_ORIGIN}/api/connectors/callback`, application id, RSA private key) before any real verification can begin — see [[Enable Banking]].
Architecture note (2026-08-20): implementing Enable Banking required generalizing PR #138's callback contract — `OpenBankingProvider` gained a `completeCallback()` lifecycle step (a no-op pass-through for GoCardless/PayPal) because Enable Banking's session isn't known until after a server-side code exchange that happens *after* the callback lands, and `activateConnection()` was split into `consumePendingConnectionSetup()` + `finalizeConnection()` so that exchange's network call never happens inside an open DB transaction. This is a structural change to the callback path all three bank/wallet providers now share; see [[Provider Callback Binding]] for why none of its existing guarantees (atomic single-use nonce, working-connection-preserved-until-verified) were weakened by the split.
Confirmed during implementation (2026-08-20): GnuCOBOL's `VALIDATE-PROVIDER-CONSENT`, `NORMALIZE-PROVIDER-ACCOUNT-TYPE`, and `NORMALIZE-PROVIDER-AMOUNT` COBOL operations were already provider-agnostic where it mattered (a generic non-`gocardless` status-mapping branch already existed) — Enable Banking required zero COBOL source changes. Read directly from `core/cobol/banking/banking-core.cob` before relying on this, not inferred.
Deployment wiring (added 2026-08-20): **implemented, not yet runtime verified**. `compose.yaml`'s connector service now sources `ENABLE_BANKING_APPLICATION_ID` from the host environment and bind-mounts the RSA private key read-only from `ENABLE_BANKING_PRIVATE_KEY_HOST_FILE` (defaulting to a committed, non-secret placeholder so deployments without Enable Banking still start cleanly). Verified with `docker compose config`/`create` in both the unconfigured and dummy-key-configured cases; actual container boot with the real key was not exercised — see [[Enable Banking]] for the full verification detail.
Relevant code/docs: `server/src/providers.js`, `server/src/enable-banking-jwt.js`, `server/migrations/009_enable_banking_provider.sql`, `.env.example`, `compose.yaml`

---

## GoCardless (bank data, PSD2 AISP) — fallback provider

Implementation: **implemented** (real GoCardless Bank Account Data API client, `server/src/providers.js` `GoCardlessProvider`)
Configuration: **optional** (requires `GOCARDLESS_SECRET_ID`/`GOCARDLESS_SECRET_KEY`)
Provider-dependent: yes
Runtime verified: **no dated successful canary artifact pinned** — `.github/workflows/runtime-canaries.yml` can check token creation and institution-list access when credentials exist, but the workflow definition itself is not execution evidence
Production verified: **no evidence found**
Last evidence: **evidence checked 2026-08-09** — no specific successful `external-runtime-canaries` run/artifact is recorded here; no completed end-to-end consent→sync→disconnect cycle is evidenced in-repo, and `docs/issue-105-live-verification.md` requires this as a manual, human-recorded step
Current limitations: README lists "live GoCardless... certification and reconciliation testing" as outstanding; `docs/bank-connection-production.md` states passing unit tests explicitly does not substitute for deployment/sandbox evidence
Fixed (code-correctness, not new runtime evidence) 2026-08-13: the server used to ignore the client-selected institution and fall back to `institutions[0]`; it now validates every selection against a live, cached, sanitized institution directory and never guesses — see [[Provider Institution Selection Contract]]. This does not change the runtime/production-verified status above.
Fixed (code-correctness, not new runtime evidence) 2026-08-18: disconnect previously only deleted the local row -- no adapter revoked the provider-side requisition. `GoCardlessProvider.disconnect()` now calls GoCardless's `DELETE /requisitions/{id}/` best-effort (never blocking local disconnect, never claiming success it can't confirm) — see [[Bank Disconnect Flow]]. Still no live-sandbox evidence that this call succeeds against a real requisition; only unit-tested against a mocked GoCardless response.
Fixed (code-correctness, not new runtime evidence) 2026-08-18: the requisition's `redirect` field previously carried the raw client page URL instead of `/api/connectors/callback`, making the callback route's nonce-consumption/replay-protection dead code for GoCardless — see [[Provider Callback Binding]] for the full fix and [[Provider Institution Selection Contract]] for the security contract this restores.
Known limitation (not fixed, documented 2026-08-18): disconnect's `store.remove()` runs unconditionally even when provider revocation fails, so a transient GoCardless outage during disconnect permanently loses the local `requisitionId` needed to ever retry the revocation — see the TODOS.md "Connections" section entry. The consent stays live at GoCardless until it naturally expires; there is no automated or manual retry path today.
Fixed (code-correctness, runtime-verified against real Postgres, not against live GoCardless) 2026-08-18: reconnect always failed with `institution_required` (empty context submitted); a healthy connection had no Disconnect path in the UI at all; and `createConnectionSetup` unconditionally overwrote a working connection the instant any new setup began, losing it permanently on an abandoned reconnect. All three found by Codex adversarial review, independently verified, fixed — see [[Bank Connections]] and [[Provider Callback Binding]].
Role change (not a runtime-evidence change) 2026-08-20: GoCardless is now the **fallback** AIS provider — [[Enable Banking]] is preferred when configured and offers the selected bank. `GoCardlessProvider` itself is functionally unchanged; it now implements the shared `completeCallback()` lifecycle method as a no-op pass-through (added to support Enable Banking's server-side code exchange) and is promoted into `connector_connections` via the new `finalizeConnection()` split of `activateConnection()` — behaviorally identical to before, runtime-verified against real Postgres (`server/test/postgres-store.test.js`), not against live GoCardless. See [[Provider Callback Binding]] and [[Bank Connections]] for the full mechanism.
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
Fixed 2026-08-13: the Connections confirmation UI previously showed one fixed "redirected to PayPal to authenticate" copy regardless of mode, which was inaccurate for owner mode (a documented invariant it was violating in production). It's now mode-aware — see [[PayPal]].
Fixed (code-correctness, not new runtime evidence) 2026-08-18: partner mode's `returnToPartnerUrl` previously carried the raw client page URL instead of `/api/connectors/callback`, making the callback route's nonce-consumption/replay-protection dead code for PayPal-partner (owner mode already routed through it correctly). Also fixed the same day: the callback route's success redirect appended no query params at all, so even the pre-existing owner-mode success path likely never triggered the frontend's automatic sync — see [[Provider Callback Binding]] for the full fix.
**Security fix 2026-08-18** (Codex adversarial review, independently verified): `PayPalProvider.sync()` had no per-merchant token isolation for partner mode — any authenticated user with a partner-mode connection received the deployment owner's own PayPal data. Fixed to fail closed (`sync()` throws for partner-mode credentials) rather than leak data; partner mode still does not functionally work end-to-end (tracked in TODOS.md "Connections" section — needs real per-merchant OAuth token exchange, not attempted without a live PayPal partner sandbox).
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

## Diagram

`diagrams/provider-connection-flow.mmd`, embedded in `docs/OPEN_BANKING_ARCHITECTURE.md`'s "Provider contract" section — the generic redirect/consent/callback sequence shared by GoCardless, PayPal, and Google subscriptions, with an explicit "NOT provider or production verified" note at the top of the diagram itself so the choreography being correct on paper is never mistaken for a completed live cycle. Added during `/diagram` (PR #131, 2026-08-11).

## Detailed subgraph

[[Providers Index]] mirrors this note's verification table as individually-linkable atomic nodes (one per provider, each with its own implementation/config/test/verification-state breakdown) so a specific provider can be reached directly from [[Pages Index]], [[Flows Index]], or [[Security Index]] without returning here first.

Related: [[Authentication]], [[Bank Connections]], [[Enable Banking]], [[PayPal]], [[AI System]], [[Known Issues and Limitations]], [[Rejected Approaches]], [[Providers Index]], [[Provider Callback Binding]], [[Bank Disconnect Flow]]
