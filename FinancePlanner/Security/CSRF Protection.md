---
type: security
domain: security
status: implemented
---

# CSRF Protection

Provider/OAuth redirects are protected by [[OAuth State and Nonce]] (signed, short-lived, single-use state values) rather than a general-purpose CSRF token scheme; the session cookie's `SameSite=Lax` attribute provides the baseline cross-site request defense for authenticated API calls.

Related: [[Security Index]] · [[OAuth State and Nonce]] · [[Session Cookie]]
