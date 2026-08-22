---
type: testing
domain: auth
status: implemented
---

# Full Logout Tests

`src/AccountPage.test.tsx` verifies the full-logout ordering contract:

1. flush encrypted cloud state while still authenticated;
2. execute server logout/session revocation;
3. only on success clear unlocked application state and lock the vault;
4. on server logout failure retain decrypted state and show an error rather than pretending logout succeeded.

The copy also reflects the existing per-user session revocation behavior and explicitly distinguishes removal of decrypted in-memory state from deletion of the encrypted local vault.

Related: [[Logout]] · [[Logout Flow]] · [[Session Revocation]]
