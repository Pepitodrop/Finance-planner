---
type: flow
domain: auth
status: implemented
---

# Logout Flow

[[Account Page]] → flush pending encrypted cloud state while authenticated → `POST /api/auth/logout` → [[auth-router.js]] clears the browser cookie and calls `revokeSession(userId)` → [[Session Revocation]] registry marks the user's sessions revoked → client clears unlocked state and calls `lockVault()` so the in-memory key and decrypted payload are discarded.

- **Server revocation is per-user, not per-token.** Logging out invalidates other active Finance Planner sessions for the same user on their next check.
- **Local encrypted vault is preserved.** Full logout removes decrypted/in-memory access, not the encrypted account-bound vault stored on the device.
- **Failure is fail-closed in the UI.** If the server logout fails, the client does not discard state and pretend the user is logged out while the cookie may still be valid.
- **Authentication identity is preserved.** `auth_store` remains intact, so the next sign-in retains the display name/passkeys; logout is distinct from account deletion.

Related: [[Logout]] · [[Session Revocation]] · [[Vault Encryption]] · [[Security Decisions]] · [[Account Page]]
