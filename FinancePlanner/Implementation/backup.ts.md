---
type: file
domain: data
status: implemented
---

# backup.ts

- **Owns:** client-side export/import — PBKDF2-SHA-256-derived key, AES-256-GCM envelope, `kdf: 'PBKDF2-SHA-256'` field, separate export password from the vault/account password
- **Known gap:** covers loaded `AppState` only, not server-only records

Related: [[Implementation Index]] · [[Backup Flow]] · [[Restore Flow]] · [[Data and Backup Page]]
