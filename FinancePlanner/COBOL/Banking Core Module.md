---
type: file
domain: cobol
status: implemented
---

# banking-core.cob

- **Program-ID:** `BANKING-CORE`
- **Responsibilities:** provider account-type normalization, [[Fixed-Point Financial Calculations]] (provider decimal → cents), [[Consent-State Classification]], [[Read-Only Scope Enforcement]] (rejects any provider scope string containing money-movement terms — hard block against payment-initiation capability leaking in), [[Reconciliation and Deduplication]], credit-card normalization
- **Node caller:** [[cobol-banking-core.js]] (`CobolBankingCore` class, `COBOL_BANKING_BINARY` default `/app/cobol/banking-core`, 2s timeout, 16KB max buffer)
- **Used by:** [[Bank Connection Flow]], [[Bank Sync Flow]], [[Bank Consent Flow]], [[PayPal]]

Related: [[COBOL Index]] · [[Bank Connections]] · [[GoCardless]]
