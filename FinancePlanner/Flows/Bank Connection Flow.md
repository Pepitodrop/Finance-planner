---
type: flow
domain: provider
status: provider-dependent
---

# Bank Connection Flow

[[Connections Page]] → bank selected → runtime provider resolution picks [[Enable Banking]] (preferred) or [[GoCardless]] (fallback) — see [[Bank Connections]] — → server validates return-URI origin, issues short-lived single-use state, redirects to the resolved provider → user authenticates/consents on the provider's own site → callback returns to the server → account list becomes available (read-only).

## Where provider authorization actually happens (added 2026-08-25): a popup, not this tab

The "redirects to the resolved provider" step above happens inside a separate popup window, not the current tab, for every provider ([[Provider Authorization Popup Bridge]], `src/providerReturnBridge.ts`) — the original Finance Planner tab stays mounted so its in-memory-only vault key is never destroyed by a same-tab navigation. **Production invariant, hardened after a PR #154 review:** if the browser blocks the popup, or the tab-local return binding (`sessionStorage`) can't be created, `startConnector()` fails closed *before* this flow's `/start` step ever runs — no provider authorization nonce is created, the current tab is never navigated, and the user sees a retryable error asking them to allow pop-ups/site storage. There is no same-tab or embedded-widget fallback in production; an earlier version of this branch had one, and it was found (in review) to recreate the exact vault-reset problem the popup exists to prevent — see [[Rejected Approaches]]. The popup's own return trip carries only `{attemptId, provider, error}` — bounded, allow-listed values, never the OAuth `code`/`state`/`error_description` — back to the original tab, which then re-enters this same flow's existing callback-handling UI.

The callback step itself now has two shapes, both going through the same generic contract (added 2026-08-20 for Enable Banking, see [[Provider Callback Binding]]):
- **GoCardless / PayPal owner:** the entire credential (requisition id / verified balance access) is already known at `start()` time — `completeCallback()` is a no-op pass-through.
- **Enable Banking:** the callback URL carries an authorization `code`; `EnableBankingProvider.completeCallback()` exchanges it server-side via `POST /sessions` — this is the step that only runs *after* the server's own state/nonce verification has already succeeded, and only its result gets promoted into the live connection (`finalizeConnection()`).

- **Backend:** [[providers.js]] `EnableBankingProvider`, `GoCardlessProvider`
- **COBOL boundary:** account-type normalization, consent-state classification happen in [[Banking Core Module]] before data is trusted — confirmed provider-agnostic for both adapters, see [[Enable Banking]]
- **Verification state:** implemented / **not runtime or production verified** — see [[Provider Status]]

Related: [[Bank Connections]] · [[Bank Consent Flow]] · [[Enable Banking]] · [[GoCardless]] · [[Provider Callback Binding]] · [[Provider Authorization Popup Bridge]]
