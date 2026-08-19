---
type: flow
domain: provider
status: provider-dependent
---

# Bank Connection Flow

[[Connections Page]] → bank selected → runtime provider resolution picks [[Enable Banking]] (preferred) or [[GoCardless]] (fallback) — see [[Bank Connections]] — → server validates return-URI origin, issues short-lived single-use state, redirects to the resolved provider → user authenticates/consents on the provider's own site → callback returns to the server → account list becomes available (read-only).

The callback step itself now has two shapes, both going through the same generic contract (added 2026-08-20 for Enable Banking, see [[Provider Callback Binding]]):
- **GoCardless / PayPal owner:** the entire credential (requisition id / verified balance access) is already known at `start()` time — `completeCallback()` is a no-op pass-through.
- **Enable Banking:** the callback URL carries an authorization `code`; `EnableBankingProvider.completeCallback()` exchanges it server-side via `POST /sessions` — this is the step that only runs *after* the server's own state/nonce verification has already succeeded, and only its result gets promoted into the live connection (`finalizeConnection()`).

- **Backend:** [[providers.js]] `EnableBankingProvider`, `GoCardlessProvider`
- **COBOL boundary:** account-type normalization, consent-state classification happen in [[Banking Core Module]] before data is trusted — confirmed provider-agnostic for both adapters, see [[Enable Banking]]
- **Verification state:** implemented / **not runtime or production verified** — see [[Provider Status]]

Related: [[Bank Connections]] · [[Bank Consent Flow]] · [[Enable Banking]] · [[GoCardless]] · [[Provider Callback Binding]]
