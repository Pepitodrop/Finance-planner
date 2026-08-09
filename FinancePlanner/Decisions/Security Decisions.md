# Security Decisions

---

**Decision:** `AUTH_MODE=local` (unauthenticated session minting) is hard-blocked in production.
**Status:** implemented, enforced at boot.
**Rationale (stated):** `server/src/runtime-security.js` throws if `NODE_ENV==='production' && AUTH_MODE==='local'`, citing that it mints unauthenticated sessions via `POST /api/session/local`. Verified by `runtime-security.test.js` (rejected even without `PUBLIC_DEPLOYMENT` set; allowed only in `NODE_ENV=development`).
**Consequences:** Compose's safe default is `AUTH_MODE=google`; CI's own production-acceptance browser suite runs under `AUTH_MODE=local`, so that suite is not evidence of a real-auth production configuration — see [[Provider Status]].
**Relevant files:** `server/src/runtime-security.js`, `server/src/runtime-security.test.js`, `compose.yaml`.

---

**Decision:** Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` whenever the origin is HTTPS; sessions can be centrally revoked.
**Status:** implemented.
**Rationale (inferred):** standard session-fixation/XSS-exfiltration mitigation, paired with a Postgres-backed revocation registry so a compromised session can be invalidated without waiting for cookie expiry.
**Relevant files:** `server/src/auth-router.js` (`cookie()` helper), `server/src/session-revocation.js`.

---

**Decision:** Passkey authentication-options endpoint always returns a real challenge with HTTP 200, regardless of whether the email matches a known account.
**Status:** implemented, fixed 2026-08-02.
**Rationale (stated):** prevents user enumeration — previously the endpoint threw (and leaked account existence) for unregistered emails. Covered by `server/test/auth-router.test.js`.
**Relevant files:** `server/src/auth-router.js`, `TODOS.md` ("Completed" section).
**Related:** [[Authentication]]

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
