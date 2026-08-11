---
type: flow
domain: provider
status: provider-dependent
---

# Bank Connection Flow

[[Connections Page]] → institution selected → server validates return-URI origin, issues short-lived single-use state, redirects to [[GoCardless]] → user authenticates/consents on GoCardless's own site → callback returns to the server → requisition/link created → account list becomes available (read-only).

- **Backend:** [[providers.js]] `GoCardlessProvider`
- **COBOL boundary:** account-type normalization, consent-state classification happen in [[Banking Core Module]] before data is trusted
- **Verification state:** implemented / **not runtime or production verified** — see [[Provider Status]]

Related: [[Bank Connections]] · [[Bank Consent Flow]] · [[GoCardless]]
