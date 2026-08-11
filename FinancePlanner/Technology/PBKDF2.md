---
type: technology
domain: security
status: implemented
---

# PBKDF2

- **Where used:** browser vault key derivation ([[vault.ts]]) and client-side backup encryption ([[backup.ts]])
- **Configuration:** PBKDF2-SHA-256, 310,000 iterations, account-bound AAD (vault); same KDF label used for backup envelopes
- **Distinct from server-side password hashing:** the server uses [[scrypt]] for account passwords — PBKDF2 is specifically the *vault/backup* key-derivation function, a different control for a different secret

Related: [[Technology Index]] · [[Vault Encryption]] · [[PBKDF2 Configuration]]
