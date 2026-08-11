---
type: flow
domain: data
status: implemented
---

# Restore Flow

[[Data and Backup Page]] → user selects a backup file + export password → [[backup.ts]] re-derives the PBKDF2 key, decrypts and validates the envelope (`kdf` field checked, malformed envelopes rejected) → restored state written back through the normal vault/sync path (same as any local edit).

- **Related test/CI evidence:** `config-and-restore-drill` CI job — verified green at PR #131's final HEAD (`/ship` phase)

Related: [[backup.ts]] · [[Backup Flow]] · [[Config and Restore Drill]]
