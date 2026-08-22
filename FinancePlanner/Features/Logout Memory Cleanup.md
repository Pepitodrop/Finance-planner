---
type: feature
domain: security
status: implemented
---

# Logout Memory Cleanup

After successful server logout Finance Planner clears the unlocked application state and calls `lockVault()`, removing the in-memory key and decrypted payload while preserving the encrypted local vault.

Related: [[Logout]] · [[Logout Flow]] · [[Vault Encryption]]
