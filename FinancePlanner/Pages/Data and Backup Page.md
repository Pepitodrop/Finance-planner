---
type: page
domain: data
status: implemented
---

# Data and Backup (page)

Secondary nav, "Data & account" group (`id: 'data'`). Client-side encrypted export/import and "Clear financial data".

- **Component:** [[DataTools.tsx]]
- **Logic:** [[backup.ts]] — PBKDF2-SHA-256-derived, AES-256-GCM envelope, `kdf: 'PBKDF2-SHA-256'`
- **"Clear financial data":** honest operation — never reseeds demo data, produces `emptyProductionState` (renamed from misleading "Reset financial data")
- **Known gap:** export is client-side-only, does not cover server-only records (session revocations, connector metadata) — see [[Known Issues and Limitations]]
- **Related tests:** `src/DataTools.test.tsx`, `src/dataTools/CreateBackup.test.tsx`, `src/dataTools/VaultPasswordChange.test.tsx`

Related: [[Data and Persistence]] · [[Backup Flow]] · [[Account Page]]
