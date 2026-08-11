---
type: security
domain: security
status: implemented
---

# Logout

`POST /api/auth/logout` clears the browser cookie **and** calls `revokeSession(userId)`. See [[Logout Flow]] for the full sequence and [[Session Revocation]] for the underlying mechanism.

Related: [[Security Index]] · [[Logout Flow]] · [[Session Revocation]] · [[Account Page]]
