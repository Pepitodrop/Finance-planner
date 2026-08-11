---
type: security
domain: security
status: implemented
---

# OAuth State and Nonce

`issueState`/`verifyState` ([[security.js]]) protect the Google OAuth redirect against CSRF and replay: a signed, short-lived state value is issued at `/api/auth/google/start` and verified at `/api/auth/google/callback`; the ID-token `nonce` is separately verified.

- **Reused for provider callbacks generally:** [[oauth_nonces (table)]] backs single-use state for GoCardless/PayPal flows too, not just Google

Related: [[Security Index]] · [[Google OAuth Flow]] · [[Provider Callback Binding]] · [[oauth_nonces (table)]]
