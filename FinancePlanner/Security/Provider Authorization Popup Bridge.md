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
  -> beginConnectorPopupAttempt(provider): writes POPUP_ORIGIN_MARKER_KEY to
     THIS tab's sessionStorage, then window.open('about:blank', ...)
     synchronously, inside the click's call stack (required for the popup
     to count as user-gesture-triggered, not blocked), then immediately
     removes that marker from THIS tab's sessionStorage again
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
     genuine popup return, React never mounts there at all
  -> reads {attemptId, provider, error} from the URL query string -- never
     the OAuth `code`, never `state`, never the free-text
     `error_description` Finance Planner's own callback route may have
     appended -- AND requires this document's own sessionStorage to still
     carry POPUP_ORIGIN_MARKER_KEY matching that attemptId (see "Popup-context
     binding" below); either check failing falls through to mounting the
     app normally instead of short-circuiting
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
- **Bounded return metadata, enforced**: `provider` on an incoming return signal must be exactly one of Finance Planner's own four connector ids (`enablebanking`/`gocardless`/`finapi`/`paypal`); `error` must match a short machine-code charset (`^[A-Za-z0-9_.-]{1,64}$`). Free text, oversized values, spaces, HTML, and URLs are all rejected outright — this closes the gap between the bridge's stated contract ("only bounded callback metadata crosses this boundary") and what `parseSignal()` actually enforced (fixed 2026-08-25).
- **Popup-context binding, not just URL-shape (fixed 2026-08-25, second PR #154 review round)**: `publishConnectorReturnFromPopup()` requires the returning document's own `sessionStorage` to carry `POPUP_ORIGIN_MARKER_KEY` matching the URL's attemptId before it short-circuits bootstrap. This relies on a spec'd browser behavior, not a new invention: a same-origin browsing context created via `window.open()` receives a one-time *clone* of the opener's `sessionStorage` at creation time (distinct from `localStorage`, which is origin-wide and continuously shared, and unlike the anti-tracking mitigations some browsers apply to `window.name`, which is why this bridge does not use `window.name` for this). `beginConnectorPopupAttempt()` writes the marker to the opener's `sessionStorage` immediately before `window.open()` — so the clone captures it — then immediately removes it from the opener again, so only the freshly-created popup's own (now independently-scoped) storage area retains it. `sessionStorage` itself stays scoped per (browsing context, origin) pair, so the popup keeps its own Finance-Planner-origin storage area, marker included, intact across its round trip through the cross-origin provider. Independently reviewed (2026-08-25): the write/open/remove sequence in `beginConnectorPopupAttempt()` has no `await` between steps, so nothing can interleave inside the tab; the residual risk (an XSS-capable attacker in Finance Planner's own origin could forge the marker) is out of scope, since this hardening targets a normal/crafted-URL tab, not an XSS-capable attacker. See "Bugs found and fixed" below for the gap this closed.
- **Cross-user logout boundary (found + fixed 2026-08-25)**: the pending-attempt binding lives in `sessionStorage`, which is tab-scoped but NOT user-scoped. Without clearing it, a different user logging into the same browser tab after a previous user abandoned a connection attempt could have that stale attempt's return signal silently accepted (the bridge only checks attemptId/provider, never which account is authenticated — that's enforced server-side via the signed state's own `sub` claim, so no financial data could actually leak this way, but it could still spuriously trigger an unrelated user's tab into a "Checking your connection" resync). Fixed with `clearPendingConnectorAttempt()`, called from `AuthGate.tsx`'s `logout()` only — deliberately **not** called on a vault lock, since a lock is momentary for the *same* already-authenticated user and an in-flight popup attempt should survive it (and already does, since the binding lives outside React state entirely).
- **This bridge never revokes anything server-side (documented explicitly 2026-08-25, second PR #154 review round)**: `abandonConnectorPopupAttempt()` (user cancel/back/close) and `clearPendingConnectorAttempt()` (logout) only ever touch this tab's own `sessionStorage`/`localStorage` records and close the popup window. Neither has, or claims to have, any effect on the signed OAuth/PSD2 `state` issued at `/start` time (`server/src/security.js` `issueState()`, 10-minute default TTL, confirmed by reading the source: `ttlSeconds = options.ttlSeconds ?? 600` — no `ttlSeconds` override is passed at the `/start` call site in `server/src/server.js`) or its matching `oauth_nonces` database row. If the popup had already progressed far enough to reach Finance Planner's own callback route before the user cancelled/logged out, that callback still finalizes server-side, bound to whichever account the signed state's own `sub` names — independent of this client-side bridge, and independent of whether that account is currently logged in in any particular tab. See [[Provider Callback Binding]] for the actual trust boundary this describes, and "Cancellation/logout does not cancel an in-flight provider callback" below for the known gap this leaves.

## Popup lifecycle: why `Window.closed` polling was removed, not fixed (2026-08-25, second PR #154 review round)

Finance Planner sends `Cross-Origin-Opener-Policy: same-origin` (`server/src/server.js`) — a real cross-window-attack mitigation, not something to weaken for this bridge's convenience. `ConnectionsPage.tsx` previously polled `popupAttempt.popup.closed` every 500ms and treated `true` as "the user manually closed the secure window," surfacing a "Secure window closed" error state with a "Try again" button.

The problem: `startConnector()` only ever returns `{mode: 'popup'}` *after* the popup has already been navigated from `about:blank` to the real, cross-origin provider URL (see the architecture diagram above). Once that navigation happens, Finance Planner's own COOP policy moves the popup into a different browsing-context group from the opener's perspective, severing the opener's `WindowProxy` reference to it. From that point on, `.closed` is not merely "sometimes stale" — it can read `true` while the real authorization window is still open and the user is mid-login, entirely independent of whether the popup is actually still open. Every single poll performed by `ConnectionsPage.tsx`'s effect happened strictly after this severance point, so there was never a window in which the signal was trustworthy.

Two remediations were considered:
1. **Patch the heuristic** (e.g. only trust `.closed` for some bounded time, or add a second confirming signal) — rejected: there is no reliable secondary signal available once the popup is on a cross-origin page, since Finance Planner's own JS has no visibility into that page at all (by design — see "What is (and is never) transferred" above). Any patch would still be guessing.
2. **Remove the automatic detection entirely** — chosen. The waiting UI (`PopupWaitingStep` in `ConnectionsPage.tsx`) now shows one steady state with no auto-triggered "closed" branch, and a "Try again" action that is *always* available (not conditionally shown after a detected close) — it explicitly calls `abandonConnectorPopupAttempt()` on whatever popup currently exists (closing it for real, open or not — this tab genuinely cannot tell) before starting a fresh attempt, specifically to prevent a user-initiated retry from ever running two concurrent authorization attempts for the same connection. A genuine completion is still driven entirely by the bounded popup-return bridge described above, never by `.closed`.

Regression test: `ConnectionsPage.test.tsx`'s "never shows a false 'Secure window closed' state, even when the popup handle already reads closed:true (a COOP-severed handle)" test simulates the worst case — a handle that reports `closed: true` from the very start — and asserts the waiting UI is unaffected even after advancing well past the old 500ms poll interval.

## Cancellation/logout does not cancel an in-flight provider callback (documented, not fixed, 2026-08-25, second PR #154 review round)

`abandonConnectorPopupAttempt()` and `clearPendingConnectorAttempt()` are both purely local, client-side cleanup — see the "never revokes anything server-side" property above. Concretely: if a user starts a provider authorization, then logs out (or cancels in the UI) while the popup is still mid-flight, and the popup nonetheless reaches Finance Planner's own callback route before its signed `state` expires (10 minutes by default), that callback still finalizes a connection for the account named in that state — even though the user believes they abandoned the attempt, and even if they've since logged out. This is not a cross-user leak (the connection is bound to whichever account's `sub` was signed into the state at `/start` time, never to "whichever tab/session happens to be active now" — see [[Provider Callback Binding]]), but it is a real UX gap: the user's cancellation intent is not communicated to the server.

**Not fixed here** — closing it properly would need a new server-side "invalidate this pending connection setup" path (e.g. a store method to delete the matching `oauth_nonces` row by `user_id`/`consent_id` before its natural expiry, called from a new authenticated endpoint), which doesn't exist today. Tracked as a known limitation, not silently left undocumented — see [[Known Issues and Limitations]].

What *was* fixed this round: `AuthGate.tsx`'s `logout()` previously called `clearPendingConnectorAttempt()` only after `await api('/api/auth/logout', ...)` resolved successfully, so a failed or lost logout response left the local browser-side binding in place. It now runs in a `finally` block, so the local cleanup always happens regardless of whether the server request succeeds — purely local hygiene, independent of (and no substitute for) the still-missing server-side invalidation above. Independently reviewed (2026-08-25): the `try/finally` is correctly scoped so `setUser(null)` still only runs when the logout request actually succeeds (a failed request re-throws after the `finally` block runs, so the app never incorrectly acts as if the user is logged out client-side).

## Enable Banking transaction-status policy (fixed 2026-08-25, second PR #154 review round — documented here since it's the same review round's fix set, full detail in [[Enable Banking]])

Unrelated to the popup mechanism itself, but fixed in the same review round: `EnableBankingProvider.sync()` (`server/src/providers.js`) previously only checked for `PDNG` to set `pending: true`; every other status — including the documented `CNCL`, `HOLD`, `OTHR`, `RJCT`, `SCHD` — silently became `pending: false` and was imported as an ordinary booked transaction. Fixed: only `BOOK` (booked) and `PDNG` (pending) are ever imported; the other five documented statuses are skipped outright (Finance Planner's transaction model has no cancelled/held/scheduled/other category to map them to); anything outside the full seven-value documented enum throws, rather than guessing. See [[Enable Banking]] for the full fix and [[Provider Status]] for current verification status.

## Bugs found and fixed while reviewing this bridge (2026-08-25, three review rounds)

**First round** found two real, pre-existing bugs while reviewing this bridge for the Enable Banking sync fix (see [[Enable Banking]] and [[Provider Status]]):

1. **Popup-blocked fallback was unreachable dead code.** `beginConnectorPopupAttempt()` (which throws when `window.open()` returns null) was called *outside* `startConnector()`'s try/catch, so a blocked popup made the whole function reject immediately — the documented fallback to Enable Banking's embedded Auth Flow widget or a plain same-tab redirect (see [[Enable Banking Auth Flow Widget]]) was never actually reached in that case, despite code comments describing it as the intended behavior. Fixed *at the time* by catching the failure and falling through with `popupAttempt = null`, exactly like the acceptance-fixture branch already did.
2. **The bridge's own security-relevant test suite had never executed.** `src/providerReturnBridge.test.ts` had no `// @vitest-environment jsdom` pragma, so every test in it silently ran under vitest's default `node` environment and failed with `ReferenceError: localStorage is not defined` — meaning this bridge's actual security guarantees had never been confirmed by a passing test, only by code inspection. Fixed by adding the pragma.

**Second round (PR #154 review)** correctly identified that fix #1 above was itself wrong for production, plus two further gaps:

3. **The "fall through to /start" fix for #1 recreated the vault-reset regression it was reviewed alongside.** Falling through to the embedded widget or a same-tab redirect after a blocked popup is exactly the same document-unload risk this whole bridge exists to prevent. Fixed by removing the try/catch entirely for non-fixture mode: the throw now propagates straight out of `startConnector()`, before `/start` is ever called. The embedded-widget/same-tab-redirect branch is now reachable only under `VITE_ACCEPTANCE_FIXTURES=true`.
4. **`parseSignal()` didn't actually bound the return metadata it claimed to.** `provider`/`error` accepted any non-empty string. Fixed with a fixed provider allow-list and a bounded error-code charset.
5. **`clearPendingConnectorAttempt()` (logout) left an inert-but-readable buffered return record behind.** Fixed to remove the `localStorage` record too, before removing the `sessionStorage` binding.

**Third round (PR #154 review, same day)** found two deployment blockers and two further hardening gaps, all described in their own sections above:

6. `Window.closed` polling was not a reliable manual-close signal once the popup navigated cross-origin under this app's COOP policy — removed, not patched (see the dedicated section above).
7. `publishConnectorReturnFromPopup()`'s bootstrap short-circuit was triggered by URL shape alone, not bound to the popup's own browsing context — fixed with the `POPUP_ORIGIN_MARKER_KEY` sessionStorage-clone-at-creation mechanism (see "Popup-context binding" above).
8. Logout's browser-side cleanup only ran after a successful server response — fixed with `finally` (see "Cancellation/logout does not cancel an in-flight provider callback" above).
9. The Enable Banking transaction-status gap described above (found alongside, in the same round, though not part of this bridge's own code).

A stale doc comment in `src/connectors.ts` (found by the independent review of round 3's diff) still described `ConnectorPopupAttempt` as existing so a caller "can poll `attempt.popup.closed`" — fixed to explain why that is deliberately no longer true.

## Frontend lifecycle bug (found + fixed 2026-08-25, separate from the bug lists above)

`startConnector()` returned `{mode: 'redirect'}` for a *successful* popup launch, reusing the same result value every other provider's real same-tab navigation uses. `ConnectionsPage.tsx`'s `startProvider()` treated `'redirect'` as "the current tab is about to unload, leave `busy=true` forever" — correct for an actual same-tab redirect, wrong for a popup, since the current tab never navigates. This left the Connections setup modal permanently stuck busy after every successful popup launch. Fixed by adding a distinct `{mode: 'popup', attempt}` result and a `PopupWaitingStep` component in `ConnectionsPage.tsx` that clears `busy`, shows a calm waiting message, and genuinely closes the popup (`abandonConnectorPopupAttempt`) on Cancel, Back, closing the setup dialog, or picking a different institution.

## Verification

`src/providerReturnBridge.test.ts` (25 cases as of 2026-08-25): attempt binding, popup-blocker failure, mismatch rejection, code/state/error_description leakage prevention, single-use buffered-return consumption, expiry, replay rejection, `abandonConnectorPopupAttempt`, `clearPendingConnectorAttempt` (localStorage-buffer cleanup, no-op safety, storage-failure safety), BroadcastChannel delivery of a valid signal and rejection of a malformed one, the bounded provider/error allow-list, and the popup-context marker (a crafted URL with no marker never short-circuits; `beginConnectorPopupAttempt()` genuinely removes the marker from the opener; a marker for the wrong attemptId doesn't match; the marker is single-use). `src/connectors.startConnector.test.ts` (14 cases): popup-success mode/no-navigation, provider-agnostic behavior, the popup-specific return URL in the `/start` request body, popup abandonment on a failed `/start`, the embedded-auth/same-tab-redirect response-shape handling confined to acceptance-fixture mode, and both production fail-closed cases (popup blocked, storage unavailable). `src/features/connections/ConnectionsPage.test.tsx` (85 cases total): busy clears and the waiting copy renders; the COOP-severed-handle regression test described above; "Try again" always available and abandons the prior attempt first; Cancel/Back/closing the setup dialog all genuinely close the real popup. `src/AuthGate.test.tsx` (10 cases total): logout clears the pending attempt binding, including when the logout request itself fails.

Independently reviewed (2026-08-25) via a dedicated adversarial subagent pass covering all of the above plus the Enable Banking status mapping and the logout try/finally scoping: no CRITICAL/HIGH/MEDIUM findings; one cosmetic stale-comment finding (see "Bugs found and fixed" above), fixed.

**Not yet re-verified live** — the fourth Mock ASPSP pass (2026-08-25) exercised an earlier version of this bridge against a real provider callback for the first time, before any of the bugs above (including this session's third round) were found and fixed. A fresh live pass is needed to confirm the corrected behavior end to end, including that a real cross-origin popup round trip actually triggers the sessionStorage clone this session's popup-context-binding fix depends on (verified only against jsdom's simulated storage in tests, never a real browser's popup-creation behavior).

Related: [[Enable Banking]] · [[Bank Connections]] · [[Provider Callback Binding]] · [[Enable Banking Auth Flow Widget]] · [[Provider Status]] · [[Connections Page]] · [[Enable Banking Sandbox UX]] · [[Known Issues and Limitations]] · [[Rejected Approaches]]
