---
type: flow
domain: data
status: implemented
---

# Backup Flow

[[Data and Backup Page]] → user sets an export password (distinct from the vault/account password, minimum 12 characters) → [[backup.ts]] derives a key via PBKDF2-SHA-256 → finance data (client-loaded `AppState` only) is AES-256-GCM-encrypted into a downloadable envelope (`kdf: 'PBKDF2-SHA-256'`).

- **Scope limitation:** covers loaded `AppState` only, not server-only records (session revocations, connector metadata) — [[Known Issues and Limitations]]

Related: [[backup.ts]] · [[Data and Backup Page]] · [[Restore Flow]]
