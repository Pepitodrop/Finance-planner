---
type: security
domain: security
status: implemented
---

# Provider Authorization Popup Bridge

Opens bank/wallet provider authorization (GoCardless, PayPal, Enable Banking) in a separate popup window instead of navigating the current tab, so Finance Planner's in-memory-only, non-extractable vault decryption key survives the round trip. A same-tab redirect unloads the SPA and destroys that key, forcing an unwanted re-unlock the moment the user returns from the provider — the exact regression this bridge exists to prevent. Implemented in `src/providerReturnBridge.ts`, wired into `src/connectors.ts`'s `startConnector()` and `src/ConnectionsPanel.tsx`.

## Architecture

```
startConnector() (user clicks "Continue securely")
  -> beginConnectorPopupAttempt(provider): window.open('about:blank', ...)
     synchronously, inside the click's call stack (required for the popup
     to count as user-gesture-triggered, not blocked)
  -> random high-entropy attemptId + provider + timestamp stored in
     sessionStorage (THIS TAB ONLY) as the "pending attempt" binding
  -> POST /start (server-side, unchanged -- signed state/nonce/institution
     validation exactly as for the same-tab flow)
  -> popup.location.replace(realProviderRedirectUrl)
  -> startConnector() returns { mode: 'popup', attempt } -- the ORIGINAL
     tab's document is never touched, vault key stays in memory

[real bank/provider authorization happens IN THE POPUP, cross-origin --
 Finance Planner's JS has no visibility into that page at all]

provider redirects the POPUP back to Finance Planner's own origin
  -> the popup's OWN fresh page load runs publishConnectorReturnFromPopup()
     BEFORE React ever mounts (src/app/bootstrap.tsx) -- if this is a
     popup-return page load, React never mounts there at all
  -> reads ONLY {attemptId, provider, error} from the URL query string --
     never the OAuth `code`, never `state`, never the free-text
     `error_description` Finance Planner's own callback route may have
     appended
  -> writes that bounded signal to localStorage (this app's origin, so
     visible to every tab) AND broadcasts it via BroadcastChannel
  -> shows "Bank authorization completed. This window can close." and
     closes itself

the ORIGINAL tab (ConnectionsPanel.tsx, already mounted, vault still open)
  -> subscribeConnectorReturns() picks up the signal (BroadcastChannel, or
     the 'storage' event / a buffered localStorage read on next mount)
  -> acceptConnectorReturnSignal(): only accepted if attemptId AND (if
     present) provider match this tab's own sessionStorage-held pending
     attempt -- a mismatch is silently rejected, not surfaced as an error
  -> on acceptance: sets ?provider=/?error= on the CURRENT URL and remounts
     ConnectionsPage (key bump) -- the pre-existing, already-tested
     callback-URL-reading effect then takes over exactly as it always did
     for the classic same-tab redirect, so no new success/failure UI path
     was needed
```

## What is (and is never) transferred between the popup and the original tab

Only ever: a random `attemptId` (opaque, not derived from anything sensitive), the `provider` id, and a fixed `error` code (never free text). Never transferred: the OAuth `code`, the signed `state` value, the provider's own `error_description` text, the vault password, the derived `CryptoKey`, or any financial data. The actual authorization exchange (code-for-session, consent validation) happens entirely server-side, exactly as it always did — this bridge only relays a "something happened, here's which attempt and which provider" signal between two browser contexts of the same origin.

## Security properties

- **Attempt binding**: `acceptConnectorReturnSignal()`/`takeBufferedConnectorReturn()` both require the signal's `attemptId` to match the CURRENT tab's own `sessionStorage`-held pending record — a forged or guessed attemptId with no matching pending record is rejected.
- **Provider mismatch**: rejected if the signal names a provider different from the one the pending attempt actually started.
- **Replay protection**: accepting a signal removes the pending record; a second delivery of the identical signal (duplicate BroadcastChannel message, a second tab's storage event) is rejected the same way an attemptId mismatch is, since nothing is left to match against.
- **Attempt expiry**: a pending record older than 20 minutes (`ATTEMPT_MAX_AGE_MS`) is treated as gone, along with its buffered return record.
- **Popup blockers**: a blocked popup, or a browser that cannot persist the tab-local return binding (`sessionStorage.setItem` throwing), is a visible, retryable failure *before* `/start` is ever contacted and before any OAuth nonce is created. There is no same-tab or embedded-widget fallback for this in production (fixed 2026-08-25, see below) — either would reintroduce the exact vault-reset regression this bridge exists to avoid. `startConnector()` surfaces `beginConnectorPopupAttempt()`'s own error text directly ("Bank authorization needs a separate secure window..." / "...could not create a secure return binding...") so the user gets an actionable, retryable message.
- **Bounded return metadata, enforced**: `provider` on an incoming return signal must be exactly one of Finance Planner's own four connector ids (`enablebanking`/`gocardless`/`finapi`/`paypal`); `error` must match a short machine-code charset (`^[A-Za-z0-9_.-]{1,64}---
type: security
domain: security
status: implemented
---

# Provider Authorization Popup Bridge

Opens bank/wallet provider authorization (GoCardless, PayPal, Enable Banking) in a separate popup window instead of navigating the current tab, so Finance Planner's in-memory-only, non-extractable vault decryption key survives the round trip. A same-tab redirect unloads the SPA and destroys that key, forcing an unwanted re-unlock the moment the user returns from the provider — the exact regression this bridge exists to prevent. Implemented in `src/providerReturnBridge.ts`, wired into `src/connectors.ts`'s `startConnector()` and `src/ConnectionsPanel.tsx`.

## Architecture

```
startConnector() (user clicks "Continue securely")
  -> beginConnectorPopupAttempt(provider): window.open('about:blank', ...)
     synchronously, inside the click's call stack (required for the popup
     to count as user-gesture-triggered, not blocked)
  -> random high-entropy attemptId + provider + timestamp stored in
     sessionStorage (THIS TAB ONLY) as the "pending attempt" binding
  -> POST /start (server-side, unchanged -- signed state/nonce/institution
     validation exactly as for the same-tab flow)
  -> popup.location.replace(realProviderRedirectUrl)
  -> startConnector() returns { mode: 'popup', attempt } -- the ORIGINAL
     tab's document is never touched, vault key stays in memory

[real bank/provider authorization happens IN THE POPUP, cross-origin --
 Finance Planner's JS has no visibility into that page at all]

provider redirects the POPUP back to Finance Planner's own origin
  -> the popup's OWN fresh page load runs publishConnectorReturnFromPopup()
     BEFORE React ever mounts (src/app/bootstrap.tsx) -- if this is a
     popup-return page load, React never mounts there at all
  -> reads ONLY {attemptId, provider, error} from the URL query string --
     never the OAuth `code`, never `state`, never the free-text
     `error_description` Finance Planner's own callback route may have
     appended
  -> writes that bounded signal to localStorage (this app's origin, so
     visible to every tab) AND broadcasts it via BroadcastChannel
  -> shows "Bank authorization completed. This window can close." and
     closes itself

the ORIGINAL tab (ConnectionsPanel.tsx, already mounted, vault still open)
  -> subscribeConnectorReturns() picks up the signal (BroadcastChannel, or
     the 'storage' event / a buffered localStorage read on next mount)
  -> acceptConnectorReturnSignal(): only accepted if attemptId AND (if
     present) provider match this tab's own sessionStorage-held pending
     attempt -- a mismatch is silently rejected, not surfaced as an error
  -> on acceptance: sets ?provider=/?error= on the CURRENT URL and remounts
     ConnectionsPage (key bump) -- the pre-existing, already-tested
     callback-URL-reading effect then takes over exactly as it always did
     for the classic same-tab redirect, so no new success/failure UI path
     was needed
```

## What is (and is never) transferred between the popup and the original tab

Only ever: a random `attemptId` (opaque, not derived from anything sensitive), the `provider` id, and a fixed `error` code (never free text). Never transferred: the OAuth `code`, the signed `state` value, the provider's own `error_description` text, the vault password, the derived `CryptoKey`, or any financial data. The actual authorization exchange (code-for-session, consent validation) happens entirely server-side, exactly as it always did — this bridge only relays a "something happened, here's which attempt and which provider" signal between two browser contexts of the same origin.

## Security properties

- **Attempt binding**: `acceptConnectorReturnSignal()`/`takeBufferedConnectorReturn()` both require the signal's `attemptId` to match the CURRENT tab's own `sessionStorage`-held pending record — a forged or guessed attemptId with no matching pending record is rejected.
- **Provider mismatch**: rejected if the signal names a provider different from the one the pending attempt actually started.
- **Replay protection**: accepting a signal removes the pending record; a second delivery of the identical signal (duplicate BroadcastChannel message, a second tab's storage event) is rejected the same way an attemptId mismatch is, since nothing is left to match against.
- **Attempt expiry**: a pending record older than 20 minutes (`ATTEMPT_MAX_AGE_MS`) is treated as gone, along with its buffered return record.
). Free text, oversized values, spaces, HTML, and URLs are all rejected outright — this closes the gap between the bridge's stated contract ("only bounded callback metadata crosses this boundary") and what `parseSignal()` actually enforced (fixed 2026-08-25, see below).
- **Cross-user logout boundary (found + fixed 2026-08-25)**: the pending-attempt binding lives in `sessionStorage`, which is tab-scoped but NOT user-scoped. Without clearing it, a different user logging into the same browser tab after a previous user abandoned a connection attempt could have that stale attempt's return signal silently accepted (the bridge only checks attemptId/provider, never which account is authenticated — that's enforced server-side via the signed state's own `sub` claim, so no financial data could actually leak this way, but it could still spuriously trigger an unrelated user's tab into a "Checking your connection" resync). Fixed with `clearPendingConnectorAttempt()`, called from `AuthGate.tsx`'s `logout()` only — deliberately **not** called on a vault lock, since a lock is momentary for the *same* already-authenticated user and an in-flight popup attempt should survive it (and already does, since the binding lives outside React state entirely).

## Bugs found and fixed while reviewing this bridge (2026-08-25, two review passes)

**First pass** found two real, pre-existing bugs while reviewing this bridge for the Enable Banking sync fix (see [[Enable Banking]] and [[Provider Status]]):

1. **Popup-blocked fallback was unreachable dead code.** `beginConnectorPopupAttempt()` (which throws when `window.open()` returns null) was called *outside* `startConnector()`'s try/catch, so a blocked popup made the whole function reject immediately — the documented fallback to Enable Banking's embedded Auth Flow widget or a plain same-tab redirect (see [[Enable Banking Auth Flow Widget]]) was never actually reached in that case, despite code comments describing it as the intended behavior. Fixed *at the time* by catching the failure and falling through with `popupAttempt = null`, exactly like the acceptance-fixture branch already did.
2. **The bridge's own security-relevant test suite had never executed.** `src/providerReturnBridge.test.ts` had no `// @vitest-environment jsdom` pragma, so every test in it (attempt binding, provider-mismatch rejection, callback code/state/error_description leakage prevention, buffered-return consumption) silently ran under vitest's default `node` environment and failed with `ReferenceError: localStorage is not defined` — meaning this bridge's actual security guarantees had never been confirmed by a passing test, only by code inspection. Fixed by adding the pragma; all 5 original tests plus 6 new ones (expiry, replay, `abandonConnectorPopupAttempt`, `clearPendingConnectorAttempt`, BroadcastChannel delivery, malformed-payload rejection) now genuinely pass.

**Second pass (PR #154 review)** correctly identified that fix #1 above was itself wrong for production, plus two further gaps:

3. **The "fall through to /start" fix for #1 recreated the vault-reset regression it was reviewed alongside.** Falling through to the embedded widget or a same-tab redirect after a blocked popup is exactly the same document-unload risk this whole bridge exists to prevent — a popup being blocked doesn't make it safe to unload the tab instead, it makes provider authorization impossible to start safely at all right now. Fixed by removing the try/catch entirely for non-fixture mode: `beginConnectorPopupAttempt()`'s throw now propagates straight out of `startConnector()`, before `/api/connectors/{provider}/start` is ever called, before any provider authorization nonce exists server-side, and before the current tab is touched. The embedded-widget/same-tab-redirect branch in `startConnector()` is now reachable only under `VITE_ACCEPTANCE_FIXTURES=true`, which never opens a real popup by design.
4. **`parseSignal()` didn't actually bound the return metadata it claimed to.** `provider` accepted any non-empty string and `error` accepted any non-empty string — so an attacker who could get a crafted URL onto Finance Planner's own origin (e.g. `?fp_connection_attempt=<valid-id>&provider=<anything>` or `&error=<free text>`) could get arbitrary strings written into `localStorage`/broadcast over `BroadcastChannel`, undermining the "only bounded callback metadata crosses this boundary" claim. Fixed with a fixed provider allow-list (`enablebanking`/`gocardless`/`finapi`/`paypal`) and a bounded error-code charset (`^[A-Za-z0-9_.-]{1,64}---
type: security
domain: security
status: implemented
---

# Provider Authorization Popup Bridge

Opens bank/wallet provider authorization (GoCardless, PayPal, Enable Banking) in a separate popup window instead of navigating the current tab, so Finance Planner's in-memory-only, non-extractable vault decryption key survives the round trip. A same-tab redirect unloads the SPA and destroys that key, forcing an unwanted re-unlock the moment the user returns from the provider — the exact regression this bridge exists to prevent. Implemented in `src/providerReturnBridge.ts`, wired into `src/connectors.ts`'s `startConnector()` and `src/ConnectionsPanel.tsx`.

## Architecture

```
startConnector() (user clicks "Continue securely")
  -> beginConnectorPopupAttempt(provider): window.open('about:blank', ...)
     synchronously, inside the click's call stack (required for the popup
     to count as user-gesture-triggered, not blocked)
  -> random high-entropy attemptId + provider + timestamp stored in
     sessionStorage (THIS TAB ONLY) as the "pending attempt" binding
  -> POST /start (server-side, unchanged -- signed state/nonce/institution
     validation exactly as for the same-tab flow)
  -> popup.location.replace(realProviderRedirectUrl)
  -> startConnector() returns { mode: 'popup', attempt } -- the ORIGINAL
     tab's document is never touched, vault key stays in memory

[real bank/provider authorization happens IN THE POPUP, cross-origin --
 Finance Planner's JS has no visibility into that page at all]

provider redirects the POPUP back to Finance Planner's own origin
  -> the popup's OWN fresh page load runs publishConnectorReturnFromPopup()
     BEFORE React ever mounts (src/app/bootstrap.tsx) -- if this is a
     popup-return page load, React never mounts there at all
  -> reads ONLY {attemptId, provider, error} from the URL query string --
     never the OAuth `code`, never `state`, never the free-text
     `error_description` Finance Planner's own callback route may have
     appended
  -> writes that bounded signal to localStorage (this app's origin, so
     visible to every tab) AND broadcasts it via BroadcastChannel
  -> shows "Bank authorization completed. This window can close." and
     closes itself

the ORIGINAL tab (ConnectionsPanel.tsx, already mounted, vault still open)
  -> subscribeConnectorReturns() picks up the signal (BroadcastChannel, or
     the 'storage' event / a buffered localStorage read on next mount)
  -> acceptConnectorReturnSignal(): only accepted if attemptId AND (if
     present) provider match this tab's own sessionStorage-held pending
     attempt -- a mismatch is silently rejected, not surfaced as an error
  -> on acceptance: sets ?provider=/?error= on the CURRENT URL and remounts
     ConnectionsPage (key bump) -- the pre-existing, already-tested
     callback-URL-reading effect then takes over exactly as it always did
     for the classic same-tab redirect, so no new success/failure UI path
     was needed
```

## What is (and is never) transferred between the popup and the original tab

Only ever: a random `attemptId` (opaque, not derived from anything sensitive), the `provider` id, and a fixed `error` code (never free text). Never transferred: the OAuth `code`, the signed `state` value, the provider's own `error_description` text, the vault password, the derived `CryptoKey`, or any financial data. The actual authorization exchange (code-for-session, consent validation) happens entirely server-side, exactly as it always did — this bridge only relays a "something happened, here's which attempt and which provider" signal between two browser contexts of the same origin.

## Security properties

- **Attempt binding**: `acceptConnectorReturnSignal()`/`takeBufferedConnectorReturn()` both require the signal's `attemptId` to match the CURRENT tab's own `sessionStorage`-held pending record — a forged or guessed attemptId with no matching pending record is rejected.
- **Provider mismatch**: rejected if the signal names a provider different from the one the pending attempt actually started.
- **Replay protection**: accepting a signal removes the pending record; a second delivery of the identical signal (duplicate BroadcastChannel message, a second tab's storage event) is rejected the same way an attemptId mismatch is, since nothing is left to match against.
- **Attempt expiry**: a pending record older than 20 minutes (`ATTEMPT_MAX_AGE_MS`) is treated as gone, along with its buffered return record.
- **Popup blockers**: a blocked popup, or a browser that cannot persist the tab-local return binding (`sessionStorage.setItem` throwing), is a visible, retryable failure *before* `/start` is ever contacted and before any OAuth nonce is created. There is no same-tab or embedded-widget fallback for this in production (fixed 2026-08-25, see below) — either would reintroduce the exact vault-reset regression this bridge exists to avoid. `startConnector()` surfaces `beginConnectorPopupAttempt()`'s own error text directly ("Bank authorization needs a separate secure window..." / "...could not create a secure return binding...") so the user gets an actionable, retryable message.
- **Bounded return metadata, enforced**: `provider` on an incoming return signal must be exactly one of Finance Planner's own four connector ids (`enablebanking`/`gocardless`/`finapi`/`paypal`); `error` must match a short machine-code charset (`^[A-Za-z0-9_.-]{1,64}---
type: security
domain: security
status: implemented
---

# Provider Authorization Popup Bridge

Opens bank/wallet provider authorization (GoCardless, PayPal, Enable Banking) in a separate popup window instead of navigating the current tab, so Finance Planner's in-memory-only, non-extractable vault decryption key survives the round trip. A same-tab redirect unloads the SPA and destroys that key, forcing an unwanted re-unlock the moment the user returns from the provider — the exact regression this bridge exists to prevent. Implemented in `src/providerReturnBridge.ts`, wired into `src/connectors.ts`'s `startConnector()` and `src/ConnectionsPanel.tsx`.

## Architecture

```
startConnector() (user clicks "Continue securely")
  -> beginConnectorPopupAttempt(provider): window.open('about:blank', ...)
     synchronously, inside the click's call stack (required for the popup
     to count as user-gesture-triggered, not blocked)
  -> random high-entropy attemptId + provider + timestamp stored in
     sessionStorage (THIS TAB ONLY) as the "pending attempt" binding
  -> POST /start (server-side, unchanged -- signed state/nonce/institution
     validation exactly as for the same-tab flow)
  -> popup.location.replace(realProviderRedirectUrl)
  -> startConnector() returns { mode: 'popup', attempt } -- the ORIGINAL
     tab's document is never touched, vault key stays in memory

[real bank/provider authorization happens IN THE POPUP, cross-origin --
 Finance Planner's JS has no visibility into that page at all]

provider redirects the POPUP back to Finance Planner's own origin
  -> the popup's OWN fresh page load runs publishConnectorReturnFromPopup()
     BEFORE React ever mounts (src/app/bootstrap.tsx) -- if this is a
     popup-return page load, React never mounts there at all
  -> reads ONLY {attemptId, provider, error} from the URL query string --
     never the OAuth `code`, never `state`, never the free-text
     `error_description` Finance Planner's own callback route may have
     appended
  -> writes that bounded signal to localStorage (this app's origin, so
     visible to every tab) AND broadcasts it via BroadcastChannel
  -> shows "Bank authorization completed. This window can close." and
     closes itself

the ORIGINAL tab (ConnectionsPanel.tsx, already mounted, vault still open)
  -> subscribeConnectorReturns() picks up the signal (BroadcastChannel, or
     the 'storage' event / a buffered localStorage read on next mount)
  -> acceptConnectorReturnSignal(): only accepted if attemptId AND (if
     present) provider match this tab's own sessionStorage-held pending
     attempt -- a mismatch is silently rejected, not surfaced as an error
  -> on acceptance: sets ?provider=/?error= on the CURRENT URL and remounts
     ConnectionsPage (key bump) -- the pre-existing, already-tested
     callback-URL-reading effect then takes over exactly as it always did
     for the classic same-tab redirect, so no new success/failure UI path
     was needed
```

## What is (and is never) transferred between the popup and the original tab

Only ever: a random `attemptId` (opaque, not derived from anything sensitive), the `provider` id, and a fixed `error` code (never free text). Never transferred: the OAuth `code`, the signed `state` value, the provider's own `error_description` text, the vault password, the derived `CryptoKey`, or any financial data. The actual authorization exchange (code-for-session, consent validation) happens entirely server-side, exactly as it always did — this bridge only relays a "something happened, here's which attempt and which provider" signal between two browser contexts of the same origin.

## Security properties

- **Attempt binding**: `acceptConnectorReturnSignal()`/`takeBufferedConnectorReturn()` both require the signal's `attemptId` to match the CURRENT tab's own `sessionStorage`-held pending record — a forged or guessed attemptId with no matching pending record is rejected.
- **Provider mismatch**: rejected if the signal names a provider different from the one the pending attempt actually started.
- **Replay protection**: accepting a signal removes the pending record; a second delivery of the identical signal (duplicate BroadcastChannel message, a second tab's storage event) is rejected the same way an attemptId mismatch is, since nothing is left to match against.
- **Attempt expiry**: a pending record older than 20 minutes (`ATTEMPT_MAX_AGE_MS`) is treated as gone, along with its buffered return record.
). Free text, oversized values, spaces, HTML, and URLs are all rejected outright — this closes the gap between the bridge's stated contract ("only bounded callback metadata crosses this boundary") and what `parseSignal()` actually enforced (fixed 2026-08-25, see below).
- **Cross-user logout boundary (found + fixed 2026-08-25)**: the pending-attempt binding lives in `sessionStorage`, which is tab-scoped but NOT user-scoped. Without clearing it, a different user logging into the same browser tab after a previous user abandoned a connection attempt could have that stale attempt's return signal silently accepted (the bridge only checks attemptId/provider, never which account is authenticated — that's enforced server-side via the signed state's own `sub` claim, so no financial data could actually leak this way, but it could still spuriously trigger an unrelated user's tab into a "Checking your connection" resync). Fixed with `clearPendingConnectorAttempt()`, called from `AuthGate.tsx`'s `logout()` only — deliberately **not** called on a vault lock, since a lock is momentary for the *same* already-authenticated user and an in-flight popup attempt should survive it (and already does, since the binding lives outside React state entirely).

).
5. **`clearPendingConnectorAttempt()` (logout) left an inert-but-readable buffered return record behind.** It only removed the `sessionStorage` pending-attempt binding, not the matching `localStorage` return record for that same attempt — harmless functionally (nothing can match against it once the binding is gone), but unnecessary residue in shared browser storage after logout. Fixed to read the pending attempt first, then remove its `localStorage` record before removing the `sessionStorage` binding, all best-effort (logout must never fail because storage is unavailable).

## Frontend lifecycle bug (found + fixed 2026-08-25, separate from the two above)

`startConnector()` returned `{mode: 'redirect'}` for a *successful* popup launch, reusing the same result value every other provider's real same-tab navigation uses. `ConnectionsPage.tsx`'s `startProvider()` treats `'redirect'` as "the current tab is about to unload, leave `busy=true` forever, nothing more to do here" — correct for an actual same-tab redirect, but wrong for a popup, since the current tab never navigates. This left the Connections setup modal permanently stuck in a busy state after every successful popup launch. Fixed by adding a distinct `{mode: 'popup', attempt}` result and a `PopupWaitingStep` component in `ConnectionsPage.tsx` that: clears `busy`; shows "Bank authorization opened in a secure window. Complete it there; Finance Planner will update automatically when it returns."; polls `attempt.popup.closed` to detect the user manually closing the popup and offers "Try again"; and genuinely closes the popup (`abandonConnectorPopupAttempt`) on Cancel, the Step-3 Back arrow, closing the whole setup dialog, or picking a different institution — never just forgetting the React state while leaving a real browser window and its `sessionStorage` binding dangling.

## Verification

`src/providerReturnBridge.test.ts` (21 cases): attempt binding, popup-blocker failure, mismatch rejection, code/state/error_description leakage prevention, single-use buffered-return consumption, expiry, replay rejection, `abandonConnectorPopupAttempt`, `clearPendingConnectorAttempt` (including its localStorage-buffer cleanup, no-op safety, and storage-failure safety), BroadcastChannel delivery of a valid signal, rejection of a malformed one, and the bounded provider/error allow-list (unknown provider, free-text provider, oversized provider, valid OAuth-style error code, free-text error, oversized error, and confirming code/state/error_description never reach a BroadcastChannel delivery). `src/connectors.startConnector.test.ts` (14 cases): popup-success mode/no-navigation, provider-agnostic behavior, the popup-specific return URL in the `/start` request body, popup abandonment on a failed `/start`, the embedded-auth/same-tab-redirect response-shape handling confined to acceptance-fixture mode, and both production fail-closed cases (popup blocked, storage unavailable) asserting rejection with no `/start` call, no navigation, and no pending attempt left behind. `src/features/connections/ConnectionsPage.test.tsx` (+6 cases): busy clears and the waiting copy renders; manual popup closure is detected and offers Try again; Try again starts a fresh attempt; Cancel/Back/closing the setup dialog all genuinely close the real popup. `src/AuthGate.test.tsx` (+1 case): logout clears the pending attempt binding.

**Not yet re-verified live** — the fourth Mock ASPSP pass (2026-08-25) exercised this bridge against a real provider callback for the first time (see [[Provider Status]]), but that was before all five bugs above were found and fixed; a fresh live pass is needed to confirm the corrected (fail-closed) behavior end to end, including that a real popup-blocked browser now sees a clear, retryable error instead of any fallback.

Related: [[Enable Banking]] · [[Bank Connections]] · [[Provider Callback Binding]] · [[Enable Banking Auth Flow Widget]] · [[Provider Status]] · [[Connections Page]] · [[Enable Banking Sandbox UX]]
