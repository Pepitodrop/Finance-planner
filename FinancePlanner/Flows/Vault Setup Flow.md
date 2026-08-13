---
type: flow
domain: data
status: implemented
---

# Vault Setup Flow

New authenticated user, no existing vault → [[Vault Setup]] → user sets a device vault password → `structuredClone(emptyProductionState)` encrypted with a [[PBKDF2]]-derived key ([[vault.ts]]) → `POST /api/finance/state` uploads as version 1 → server envelope-encrypts with [[AES-256-GCM]] ([[Vault Encryption]]) → stored in [[user_finance_state (table)]].

Related: [[Vault Setup]] · [[Data and Persistence]] · [[Vault Encryption]]
