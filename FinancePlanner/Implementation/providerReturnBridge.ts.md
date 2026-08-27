---
type: file
domain: security
status: implemented
---

# providerReturnBridge.ts

- **Owns:** the full client-side implementation of [[Provider Authorization Popup Bridge]] — `beginConnectorPopupAttempt()`, `navigateConnectorPopup()`, `abandonConnectorPopupAttempt()`, `clearPendingConnectorAttempt()`, `publishConnectorReturnFromPopup()`, `acceptConnectorReturnSignal()`, `takeBufferedConnectorReturn()`, `subscribeConnectorReturns()`.
- **Called from:** `src/connectors.ts`'s `startConnector()` (begins/navigates/abandons an attempt), `src/app/bootstrap.tsx` (`publishConnectorReturnFromPopup()`, before React mounts), `src/ConnectionsPanel.tsx` (`subscribeConnectorReturns()`/`takeBufferedConnectorReturn()`), `src/AuthGate.tsx`'s `logout()` (`clearPendingConnectorAttempt()`).
- **Bounded-metadata invariant (hardened 2026-08-25, PR #154 review):** `parseSignal()` restricts an incoming return signal's `provider` to exactly one of `enablebanking`/`gocardless`/`finapi`/`paypal` and `error` to `^[A-Za-z0-9_.-]{1,64}$` — free text, oversized values, and unknown providers are all rejected. Previously any non-empty string was accepted for both fields, undermining the file's own "only bounded callback metadata crosses this boundary" claim.
- **Logout cleanup invariant (hardened 2026-08-25):** `clearPendingConnectorAttempt()` now removes both the `sessionStorage` pending-attempt binding and that attempt's buffered `localStorage` return record (previously only the former), best-effort throughout — logout must never fail because storage is unavailable.
- **Test coverage:** `src/providerReturnBridge.test.ts` (21 cases as of 2026-08-25 — attempt binding, popup-blocker/storage-failure, provider/attempt mismatch, replay rejection, expiry, bounded provider/error validation, BroadcastChannel delivery of a valid signal and rejection of a malformed one, `abandonConnectorPopupAttempt`, `clearPendingConnectorAttempt` including its storage-failure safety).

Related: [[Implementation Index]] · [[Provider Authorization Popup Bridge]] · [[connectors.ts]] · [[Provider Callback Binding]] · [[AuthGate.tsx]] · [[Logout]]
