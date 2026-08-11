# Security Decisions

---

**Decision:** `AUTH_MODE=local` (unauthenticated session minting) is hard-blocked in production.
**Status:** implemented, enforced at boot.
**Rationale (stated):** `server/src/runtime-security.js` throws if `NODE_ENV==='production' && AUTH_MODE==='local'`, citing that it mints unauthenticated sessions via `POST /api/session/local`. Verified by `runtime-security.test.js` (rejected even without `PUBLIC_DEPLOYMENT` set; allowed only in `NODE_ENV=development`).
**Consequences:** Compose's safe default is `AUTH_MODE=google`; CI's own production-acceptance browser suite runs under `AUTH_MODE=local`, so that suite is not evidence of a real-auth production configuration — see [[Provider Status]].
**Relevant files:** `server/src/runtime-security.js`, `server/src/runtime-security.test.js`, `compose.yaml`.

---

**Decision:** Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` whenever the origin is HTTPS; sessions can be centrally revoked, and logout revokes the acting session server-side (not just the browser cookie).
**Status:** implemented; the logout-revokes-server-side-token behavior was a confirmed gap, fixed and live-verified during the `/cso` security-review phase of PR #131 (2026-08-10).
**Rationale (inferred):** standard session-fixation/XSS-exfiltration mitigation, paired with a Postgres-backed revocation registry so a compromised session can be invalidated without waiting for cookie expiry.
**Rationale (fix, stated):** before the fix, `POST /api/auth/logout` only cleared the calling browser's cookie -- the signed session token itself remained valid until its natural TTL. `SessionRevocationRegistry` already existed and was wired into account deletion but not logout. Live-verified before/after: a token held in a separate cookie jar (simulating a captured/stolen token) stayed fully usable after "logout" pre-fix, and is rejected with 401 immediately after logout post-fix.
**Relevant files:** `server/src/auth-router.js` (`cookie()` helper, `POST /api/auth/logout` handler, `createAuthRouter`'s `revokeSession` param), `server/src/session-revocation.js`, `server/src/server.js` (wires `revokeSession: (user) => sessionRevocations.revoke(user)`), `server/test/auth-router.test.js` (regression coverage).
**QA confirmation (2026-08-11, `/qa` phase of PR #131):** live-tested with two separate browser contexts logged in as the same user (registered in context A, logged in with the same credentials in context B). Logging out from A also deauthenticated B (`GET /api/auth/session` on B flipped from `authenticated: true` to `authenticated: false` immediately after A's logout) — confirms revocation is genuinely user-scoped, not session-token-scoped, exactly as designed. Classified as **surprising UX but non-blocking**: a user signed in on two devices who logs out of one will find the other also signed out, which deviates from the common "logout = this device only" mental model, but is not a security defect (it is in fact a stronger security property) and was not changed. Left as a product-decision item, not altered by QA per instruction.
**Diagram:** `diagrams/session-lifecycle.mmd` (embedded in README.md's "Authentication flow" section) visualizes this exact sequence, including the per-user revocation propagating to a second, unrelated session.

---

**Decision:** Passkey authentication-options endpoint always returns a real challenge with HTTP 200, regardless of whether the email matches a known account.
**Status:** implemented, fixed 2026-08-02.
**Rationale (stated):** prevents user enumeration — previously the endpoint threw (and leaked account existence) for unregistered emails. Covered by `server/test/auth-router.test.js`.
**Relevant files:** `server/src/auth-router.js`, `TODOS.md` ("Completed" section).
**Related:** [[Authentication]]

---

**Decision:** `POST /api/auth/password/login` always performs exactly one scrypt password verification per request, regardless of whether the submitted email matches an existing account.
**Status:** implemented, fixed and live-verified 2026-08-10 (`/cso` security-review phase of PR #131).
**Rationale (stated):** closes a confirmed, measured timing side-channel that let an attacker enumerate registered emails. Before the fix, `verifyPassword()` (which runs `scryptSync`, N=16384) was only called when a matching user existed, short-circuited via `Boolean(user) && (...)`. Local measurement: known-user-wrong-password requests ~230ms median (20 samples) vs unknown-email requests ~14ms median (20 samples) — a ~16x gap distinguishable with a single request pair, no statistical sophistication required. The same gap applied to password-less (Google-only) accounts attempting password login. Fix: always verify against a real hash when one exists, otherwise against a fixed dummy hash (`DUMMY_PASSWORD_HASH`, computed once at module load), so the scrypt cost is paid unconditionally. Re-measured after the fix: both distributions overlap in the same range.
**Relevant files:** `server/src/auth-router.js` (`DUMMY_PASSWORD_HASH`, the login handler's `hashToVerify`/`passwordValid` computation), `server/src/password-auth.js` (`verifyPassword`), `server/test/auth-router.test.js` (timing regression test, generous 0.25 ratio floor to avoid CI flakiness while still catching a full regression).
**Related:** [[Authentication]]

---

**Decision:** GitHub CodeQL alert #1 (`js/insufficient-password-hash` on `server/src/auth-store.js:10`) is a confirmed false positive and has been dismissed.
**Status:** dismissed 2026-08-10 via the GitHub code-scanning API, after live dataflow inspection during the `/cso` follow-up phase of PR #131 (the prior `/cso` phase had assessed this as *likely* a false positive from architecture alone but left it undismissed and unresolved).
**Rationale (stated):** `keyFromSecret()` derives a fixed 32-byte AES-256-GCM key from `AUTH_MASTER_KEY`, an operator-configured high-entropy secret (`.env.example` requires `openssl rand -hex 32`-generated values), not a human password. This follow-up inspected the actual CodeQL dataflow rather than assuming: all 5 reported source-to-sink paths trace to hardcoded literal test-fixture strings named `authKey` in `server/test/auth-router.test.js` (lines 17, 100, 131) and `server/test/reset-and-seed-demo.test.js` (lines 51, 89) — none trace through the real production `env.AUTH_MASTER_KEY` path (`auth-router.js:78`). The identical `keyFromSecret()` construction in `user-state-store.js` (deriving from `CONNECTOR_MASTER_KEY`) is not separately flagged, consistent with a naming-heuristic false match on test constants rather than a systemic issue. User password hashing remains scrypt-based (`password-auth.js`) and is entirely unaffected.
**Consequences:** No code change was made. Replacing the SHA-256 key derivation with a password KDF would address a different threat model and would break compatibility with existing encrypted `auth-store` data without a migration — explicitly out of scope for a static-analysis false positive. Dismissed with `dismissed_reason: false positive`; the PR's native `CodeQL` check went from failing to passing immediately (no re-run needed) and `mergeStateStatus` moved from `UNSTABLE` to `CLEAN`. Alert: https://github.com/Pepitodrop/Finance-planner/security/code-scanning/1.
**Relevant files:** `server/src/auth-store.js` (`keyFromSecret`), `server/src/user-state-store.js` (`keyFromSecret`, same pattern, unflagged), `.env.example`, `server/test/auth-router.test.js`, `server/test/reset-and-seed-demo.test.js`.
**Related:** [[Authentication]], [[Provider Status]]

---

**Decision:** Passkeys require `residentKey: 'required'` and `userVerification: 'required'`.
**Status:** implemented.
**Rationale (inferred):** discoverable, user-verified credentials only — stronger phishing resistance than accepting non-resident or non-verified authenticators.
**Relevant files:** `server/src/auth-router.js`.
**Related:** [[Authentication]]

---

**Decision:** Provider banking operations never use a JavaScript financial fallback; the COBOL binary is a fail-closed hard dependency in production.
**Status:** implemented.
**Rationale (stated):** `docs/OPEN_BANKING_ARCHITECTURE.md` — "Provider banking operations do not use JavaScript financial fallbacks." `COBOL_BANKING_REQUIRED=true` in production images.
**Relevant files:** `server/src/cobol-banking-core.js`, `compose.yaml`.
**Related:** [[COBOL Domain Core]]

---

**Decision:** Hosted AI requires explicit per-request consent and a closed input schema; raw transaction descriptions/account identifiers/credentials never reach the hosted model.
**Status:** implemented.
**Rationale (stated):** `server/src/ai-router.js` — throws `ai_consent_required` unless `consentExternalAi === true`; rejects any request body field outside an allowlist. `docs/HUGGINGFACE_AI.md` — "Raw merchant descriptions, account names, transaction IDs, and credentials are excluded from the model prompt."
**Relevant files:** `server/src/ai-router.js`, `docs/HUGGINGFACE_AI.md`.
**Related:** [[AI System]]

---

**Decision:** Hosted AI model + revision must be on a reviewed allowlist; unreviewed model/revision combinations are hard-blocked at runtime, not just documented.
**Status:** implemented.
**Rationale (stated):** `server/src/ai-ensemble.js` — `REVIEWED_MODEL_REVISIONS` frozen allowlist; `reviewedModel()` throws for anything not in it. Matches the pinned revision in `ai/model-lock.json` and `compose.yaml`.
**Relevant files:** `server/src/ai-ensemble.js`, `server/src/ai-capabilities.js`, `ai/model-lock.json`.
**Related:** [[AI System]]

---

**Decision:** `HF_TOKEN` (hosted-AI secret) must never be exposed through Vite/client-side bundles.
**Status:** implemented (stated constraint; hosted client lives only in `server/src`).
**Rationale (stated):** `docs/HUGGINGFACE_AI.md` — explicit "Never expose `HF_TOKEN` through Vite variables or client-side bundles."
**Relevant files:** `server/src/huggingFaceClient.js`.

---

**Decision:** Production Docker images run with a read-only root filesystem and dropped Linux capabilities (only `CHOWN`/`SETGID`/`SETUID`/`NET_BIND_SERVICE` retained), and the connector port is bound to loopback only.
**Status:** implemented.
**Rationale (inferred):** standard container hardening — Nginx is the only intended reachable path; a compromised connector process can't easily persist or escalate.
**Relevant files:** `compose.yaml` (`web` and `connector` service definitions).
**Related:** [[Deployment]], [[Security]]

---

**Decision:** GitHub Actions supply-chain risk mitigated by pinning third-party actions to a commit SHA, not a mutable tag.
**Status:** implemented for the Trivy container-scan step.
**Rationale (stated):** `TODOS.md` (fixed 2026-08-03) — pinned specifically because `aquasecurity/trivy-action` itself was compromised in a March 2026 supply-chain attack affecting every tag from `0.0.1` through `0.34.2`; a floating tag would have reintroduced exactly the vulnerability class the step exists to catch.
**Relevant files:** `.github/workflows/ci.yml`.

Related: [[Architecture Decisions]] · [[Rejected Approaches]] · [[Provider Status]]
