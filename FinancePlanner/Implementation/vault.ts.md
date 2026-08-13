---
type: file
domain: data
status: implemented
---

# vault.ts

- **Owns:** browser-side encrypted vault — [[PBKDF2]]-SHA-256 (310k iterations) key derivation, [[AES-256-GCM]] encryption, envelope format `finance-planner-encrypted-vault` v2, one-time v1→v2 migration

Related: [[Implementation Index]] · [[Vault Encryption]] · [[Vault Setup]] · [[Vault Unlock]]
