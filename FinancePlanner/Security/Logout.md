---
type: security
domain: security
status: implemented
---

# Logout

A user-initiated full logout is a two-boundary operation:

1. while the authenticated session still exists, Finance Planner asks the encrypted cloud-sync queue to flush;
2. `POST /api/auth/logout` clears the browser cookie and calls `revokeSession(userId)`;
3. only after the server confirms logout, the client clears its unlocked application state and calls `lockVault()`, discarding the in-memory vault key and decrypted payload.

The encrypted account-bound vault remains on the device. Logout therefore removes the usable decrypted session without destructively deleting the user's encrypted local copy. If the server logout fails, Finance Planner does not clear decrypted state or claim that the user is signed out, because the session cookie may still be valid.

Authentication identity remains in `auth_store`; logout is not account deletion. This preserves the user's display name and passkeys for the next sign-in.

Related: [[Security Index]] · [[Logout Flow]] · [[Session Revocation]] · [[Vault Encryption]] · [[Account Page]]
