---
type: security
domain: security
status: implemented
---

# Secret Management

Required production secrets: `SESSION_SECRET`, `CONNECTOR_MASTER_KEY`, `AUTH_MASTER_KEY`, `METRICS_TOKEN` — each independently generated, ≥256 bits entropy, stored in a platform secret manager, never baked into images/commits/logs.

- **`HF_TOKEN`** (hosted AI) must never reach the client bundle — [[AI Consent Gate]] doesn't cover this; it's a separate, stated build/bundling constraint
- **Consequence of loss:** losing `CONNECTOR_MASTER_KEY` makes finance/provider payloads unrecoverable; losing `AUTH_MASTER_KEY` makes the auth store unrecoverable

Related: [[Security Index]] · [[Security]] · [[Secret Scanning]]
