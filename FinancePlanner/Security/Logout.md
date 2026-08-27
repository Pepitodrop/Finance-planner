---
type: security
domain: security
status: implemented
---

# Logout

`POST /api/auth/logout` clears the browser cookie **and** calls `revokeSession(userId)`. See [[Logout Flow]] for the full sequence and [[Session Revocation]] for the underlying mechanism.

**Also clears client-side bridge state (added 2026-08-25):** `src/AuthGate.tsx`'s `logout()` additionally calls `clearPendingConnectorAttempt()` ([[Provider Authorization Popup Bridge]]), removing any in-flight bank-connection popup attempt's `sessionStorage` binding and its buffered `localStorage` return record. This is deliberately **not** called on a vault lock (only on logout) — a lock is momentary for the same already-authenticated user and an in-flight popup attempt should survive it. The actual cross-account trust boundary this closes a UX-confusion risk *around* (not a data-exposure risk) is server-side `state.sub` validation — see [[Provider Callback Binding]].

Related: [[Security Index]] · [[Logout Flow]] · [[Session Revocation]] · [[Account Page]] · [[Provider Authorization Popup Bridge]]
