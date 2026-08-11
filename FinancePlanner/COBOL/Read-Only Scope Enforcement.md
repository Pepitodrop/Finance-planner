---
type: security
domain: cobol
status: implemented
---

# Read-Only Scope Enforcement

[[Banking Core Module]] rejects any provider scope string containing money-movement terms — a hard block against payment-initiation capability leaking into the app, independent of what any single provider adapter's own capability report claims.

- **Related invariant:** every registered provider (`server/src/providers.js`) reports `false` for payment-initiation/transfer/payout/order/mandate

Related: [[COBOL Index]] · [[Architecture Decisions]] · [[Bank Connections]]
