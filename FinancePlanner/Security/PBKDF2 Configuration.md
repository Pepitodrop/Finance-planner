---
type: security
domain: security
status: implemented
---

# PBKDF2 Configuration

310,000 iterations, SHA-256, used identically in [[vault.ts]] (vault key) and [[backup.ts]] (backup-envelope key) — two different secrets (device vault password vs. export password), same KDF parameters.

Related: [[Security Index]] · [[PBKDF2]] · [[Vault Encryption]] · [[Backup Flow]]
