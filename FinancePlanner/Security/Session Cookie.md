---
type: security
domain: security
status: implemented
---

# Session Cookie

`fp_session` — `HttpOnly`, `SameSite=Lax`, `Secure` when the origin is HTTPS. HMAC-based derivation requiring `SESSION_SECRET` ≥32 chars.

- **Implementation:** [[session-revocation.js]], [[security.js]] (`createSession`, `verifySessionClaims`)
- **Validity check:** not client-trusted — see [[Session Revocation]]

Related: [[Security Index]] · [[Session Revocation]] · [[Authentication Loading]]
