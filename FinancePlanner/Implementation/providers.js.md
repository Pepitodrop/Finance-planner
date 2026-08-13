---
type: file
domain: provider
status: implemented
---

# providers.js

- **Owns:** `OpenBankingProvider` contract + `OpenBankingProviderRegistry`; `GoCardlessProvider`, `PayPalProvider`, `finapi` (explicit unavailable placeholder)
- **Security invariant enforced here:** every adapter reports `false` for payment-initiation/transfer/payout/order/mandate capabilities
- **COBOL boundary:** delegates normalization/consent/reconciliation to [[Banking Core Module]]

Related: [[Implementation Index]] · [[Bank Connections]] · [[GoCardless]] · [[PayPal]]
