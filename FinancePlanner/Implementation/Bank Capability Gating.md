---
type: component
domain: provider
status: implemented
---

# Bank Capability Gating

`/health/bank` independently reports automatic account-information capability, separate from `/health/ready` (core readiness). Returns unavailable until at least one provider is correctly configured. Missing/invalid provider credentials are a bank-*capability* limitation, never treated as a core application outage.

- **Implementation:** [[server.js]] health endpoints
- **Domain control set:** `src/bankProduction.ts` — the controls `docs/bank-connection-production.md` requires be verified in the deployed environment before enabling a bank provider for real users

Related: [[Implementation Index]] · [[Bank Connections]] · [[Backend]]
