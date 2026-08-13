---
type: technology
domain: security
status: implemented
---

# AES-256-GCM

- **Where used:** server-side envelope encryption ([[user-state-store.js]], [[crypto-store.js]], [[auth-store.js]] — all assert `algorithm === 'AES-256-GCM'` on read as an integrity check) **and** the browser-side vault ([[vault.ts]]) — two independent, structurally different encryption boundaries (double encryption in transit)
- **Server key material:** `CONNECTOR_MASTER_KEY` (finance/provider data), `AUTH_MASTER_KEY` (auth store, legacy fallback to `CONNECTOR_MASTER_KEY`)
- **Client key material:** derived via [[PBKDF2]] from the device vault password, account-bound AAD
- **Related decision:** [[Security Decisions]]

Related: [[Technology Index]] · [[Vault Encryption]] · [[Encryption at Rest]]
