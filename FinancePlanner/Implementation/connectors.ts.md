---
type: file
domain: provider
status: implemented
---

# connectors.ts

- **Owns:** `startConnector()` — the frontend entry point for beginning any provider authorization (Enable Banking, GoCardless, PayPal); `ConnectorStartResult` discriminated union (`'redirect' | 'popup' | 'embedded-auth'`); `fetchProviderStatus()`/`fetchProviderInstitutions()`; `synchronizeConnections()`; `disconnectConnector()`.
- **Security invariant enforced here (hardened 2026-08-25, PR #154 review):** in production, `beginConnectorPopupAttempt()` (see [[Provider Authorization Popup Bridge]]) is called with no surrounding try/catch — its failure (blocked popup, unavailable `sessionStorage`) propagates straight out of `startConnector()`, before `/api/connectors/{provider}/start` is ever called. This is deliberate: `/start` creates a server-side provider-authorization nonce, and the only safe way to consume the redirect it returns is to hand it to a popup that never unloads the current document. An earlier version of this file caught that failure and fell through to a same-tab redirect / the Enable Banking embedded widget instead — reverted after review, see [[Rejected Approaches]].
- **`ConnectorStartResult.mode` matters to callers:** `'redirect'` means the current tab is about to navigate away (nothing left to do); `'popup'` means the current tab's document is untouched and a caller must render its own waiting UI (see [[Connections Page]]'s `PopupWaitingStep`, fixed 2026-08-25 after `'popup'` was previously misreported as `'redirect'`); `'embedded-auth'` is Enable Banking's official widget descriptor, reachable in production only when no real popup exists to redirect (in practice, only under `VITE_ACCEPTANCE_FIXTURES=true`).
- **Institution logo proxy invariant:** `providerInstitutionLogoUrl()` always returns a same-origin path — the server re-resolves and re-validates the real provider logo URL itself; the browser never learns a provider's real logo host. See [[Institution Logo Proxy]].
- **Test coverage:** `src/connectors.startConnector.test.ts` (popup success/provider-agnostic/fail-closed-on-blocked-popup/fail-closed-on-storage-failure/acceptance-fixture-mode response shapes), `src/features/connections/connectionsModel.test.ts`.

Related: [[Implementation Index]] · [[Provider Authorization Popup Bridge]] · [[Bank Connections]] · [[Connections Page]] · [[Bank Connection Flow]] · [[Rejected Approaches]]
