# Architecture Decisions

Each entry reflects a decision clearly evidenced by the current implementation/docs. Rationale is taken from the repo where stated explicitly; where inferred, it's labeled as such.

---

**Decision:** Money is represented as integer cents everywhere; no binary floating point for financial values.
**Status:** implemented, enforced.
**Context:** monetary calculations across frontend, backend and COBOL.
**Rationale (stated):** `docs/ARCHITECTURE.md` — "Monetary values use integer cents." `core/cobol/README.md` — "No binary floating-point arithmetic is used inside the COBOL core."
**Consequences:** the API rejects non-integer money values; provider decimal strings must be converted to cents by the Node adapter before crossing the COBOL boundary.
**Relevant files:** `docs/ARCHITECTURE.md`, `core/cobol/*.cob`, `server/src/finance-router.js`.

---

**Decision:** Deterministic finance/banking logic lives in compiled GnuCOBOL; AI stays advisory and cannot mutate balances.
**Status:** implemented, enforced.
**Context:** the app pairs exact accounting with probabilistic AI features (categorization, hosted reasoning).
**Rationale (stated):** `docs/AI_PRODUCTION.md` — "Exact balances, totals, projections, and transaction mutations must remain deterministic and must never depend solely on generative output." `docs/OPEN_BANKING_ARCHITECTURE.md` — the COBOL core, not Node, decides account/transaction/reconciliation validity for provider data.
**Consequences:** production sets `COBOL_BANKING_REQUIRED=true` (fail closed if the binary is missing); AI suggestions are approval-gated, never auto-applied to balances.
**Relevant files:** `core/cobol/`, `server/src/cobol-engine.js`, `server/src/cobol-banking-core.js`, `server/src/ai-router.js`.
**Related:** [[COBOL Domain Core]], [[AI System]]

---

**Decision:** PostgreSQL is the canonical cross-device store; the browser vault is an encrypted cache only.
**Status:** implemented.
**Context:** the product needs the same authenticated account/data across browsers, PWA and Android.
**Rationale (stated):** README.md — "PostgreSQL is the canonical authenticated user-data store. Browser storage is an encrypted offline cache, not the only copy."
**Consequences:** cross-device finance sync is intentionally unavailable without PostgreSQL (`CONNECTOR_STORE_DRIVER=postgres`); file-backed storage is local-dev-only.
**Relevant files:** `docs/CLOUD_DATA.md`, `docs/DATABASE.md`, `server/src/user-state-store.js`.
**Related:** [[Data and Persistence]]

---

**Decision:** Provider credentials (bank, PayPal) and tokens never reach the browser or the COBOL process; only the Node connector talks to providers.
**Status:** implemented.
**Context:** open-banking / PSD2 style account-information integrations.
**Rationale (stated):** `docs/issue-105-provider-setup.md` — bank credentials, PayPal passwords, provider access tokens "must never be returned to the browser or passed into the COBOL process."
**Consequences:** consent/OAuth redirects are server-orchestrated; the browser only ever sees the institution-selection UI and redirect target.
**Relevant files:** `server/src/providers.js`, `docs/issue-105-provider-setup.md`.
**Related:** [[Bank Connections]], [[PayPal]]

---

**Decision:** OAuth/consent redirects are used for bank/PayPal access rather than ever collecting bank credentials directly.
**Status:** implemented (GoCardless PSD2 flow; PayPal owner/partner reporting flows).
**Rationale (stated):** `docs/OPEN_BANKING_ARCHITECTURE.md` — "Finance Planner is an account-information application. It does not initiate payments, transfers, payouts, orders, mandates, or other money movement." Every provider capability report sets payment/transfer/payout/order/mandate capabilities to `false`; COBOL separately rejects scope strings containing money-movement terms.
**Relevant files:** `docs/OPEN_BANKING_ARCHITECTURE.md`, `server/src/providers.js`.
**Related:** [[Bank Connections]], [[PayPal]], [[Security Decisions]]

---

**Decision:** Writes to the shared finance state use optimistic concurrency (expected-version compare-and-swap), not last-write-wins.
**Status:** implemented.
**Rationale (inferred from behavior):** multiple devices can edit the same account; silently discarding one device's edits would be a data-loss bug. The explicit conflict UI (`VaultConflict.tsx`) exists specifically to surface this rather than auto-resolve it.
**Relevant files:** `server/src/user-state-store.js` (`SELECT ... FOR UPDATE`, version check), `server/src/finance-router.js` (409 on mismatch), `docs/CLOUD_DATA.md`.
**Related:** [[Data and Persistence]], [[Sync and Offline]]

---

**Decision:** Android ships as a Trusted Web Activity over the real browser origin, not an embedded WebView with its own storage.
**Status:** implemented.
**Rationale (stated):** `docs/ANDROID.md` — Google OAuth and passkeys need the real browser context; a TWA reuses the same authenticated API, encrypted vault and cloud state as web, rather than duplicating auth/storage inside a WebView.
**Relevant files:** `android/`, `docs/ANDROID.md`.
**Related:** [[Mobile PWA Android]]

Related: [[Security Decisions]] · [[Rejected Approaches]] · [[System Architecture]]
