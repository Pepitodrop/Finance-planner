---
type: page
domain: data
status: implemented
---

# Vault Unlock (page)

Shown to an authenticated user with an existing local or server-synced vault; requires the device vault password (separate from the account password).

- **Component:** [[VaultGate.tsx]] (unlock mode)
- **APIs called:** `GET /api/finance/state` (pulls the canonical server copy on unlock)
- **Storage:** [[vault.ts]] (PBKDF2 key derivation) decrypts the local cache; server copy from [[user_finance_state (table)]] replaces it if newer, then re-encrypted locally
- **Logic run on unlock:** [[isLegacyDemoState]] / [[removeLegacyDemoState]] — runs once per unlock, right after sync
- **Related tests:** `src/VaultGate.test.tsx`, [[Vault Tests]], [[Legacy State Cleanup Tests]]
- **Flow:** [[Vault Unlock Flow]]
- **Legacy migration:** one-time v1→v2 account-bound format migration ([[Sync and Offline]])

Related: [[Data and Persistence]] · [[Vault Setup]] · [[Vault Conflict Page]]
