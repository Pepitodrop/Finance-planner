---
type: security
domain: security
status: implemented
---

# Provider Callback Binding

`activateConnection`'s `userId` comes from the verified signed state (`state.sub`), never from client-supplied input on the callback request — prevents a callback from being bound to the wrong user's account.

- **Re-confirmed fresh 2026-08-11 (`/ship`):** call-site read directly in `server.js`.

Related: [[Security Index]] · [[OAuth State and Nonce]] · [[Bank Connection Flow]]
