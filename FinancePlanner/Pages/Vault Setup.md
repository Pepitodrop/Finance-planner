---
type: page
domain: data
status: implemented
---

# Vault Setup (page)

Shown to a newly-authenticated user with no existing encrypted vault. Creates a genuinely empty financial state, never reseeds sample data.

- **Component:** [[VaultGate.tsx]] (setup mode)
- **Child/overlapping component:** [[Passkey Enrolment Banner]] — flows above this card rather than floating over it ([[Debugging Learnings]])
- **Storage:** `structuredClone(emptyProductionState)` from [[data.ts]] → [[vault.ts]] (browser encryption) → `POST /api/finance/state` (version 1) → [[user_finance_state (table)]]
- **Security controls:** [[Vault Encryption]] ([[PBKDF2]], [[AES-256-GCM]], account-bound AAD)
- **Related tests:** `src/VaultGate.test.tsx`, [[Vault Tests]]
- **Flow:** [[Vault Setup Flow]]
- **Known issue fixed here:** fresh-account data integrity (PR #131) — see [[Legacy-Demo-State Cleanup]]

Related: [[Data and Persistence]] · [[Vault Unlock]] · [[Login and Registration]]
