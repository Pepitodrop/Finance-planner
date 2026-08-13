---
type: security
domain: data
status: implemented
---

# Encryption Boundary (server)

[[user-state-store.js]], [[crypto-store.js]], [[auth-store.js]] all use `aes-256-gcm` via Node's `crypto` module and assert `algorithm === 'AES-256-GCM'` on read as an integrity check — a structurally independent boundary from the browser [[Vault Encryption]] (double encryption in transit: local vault format re-derived per device, then wrapped again server-side).

Related: [[Data Index]] · [[AES-256-GCM]] · [[Vault Encryption]]
