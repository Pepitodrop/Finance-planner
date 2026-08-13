---
type: security
domain: security
status: implemented
---

# Vault Encryption (browser)

- **KDF:** [[PBKDF2]]-SHA-256, 310,000 iterations
- **Cipher:** [[AES-256-GCM]]
- **Binding:** account-bound AAD (device vault password, not the account password)
- **Envelope format:** `finance-planner-encrypted-vault`, version 2 (one-time legacy v1→v2 migration on first successful unlock)
- **Implementation:** [[vault.ts]]

Related: [[Security Index]] · [[PBKDF2 Configuration]] · [[Vault Setup]] · [[Vault Unlock]]
