---
type: flow
domain: provider
status: provider-dependent
---

# Bank Sync Flow

Established connection → periodic/manual sync → GoCardless returns paginated transactions → Node adapter converts provider decimal strings to integer cents → [[Transaction Normalization]] and [[Reconciliation and Deduplication]] (both in [[Banking Core Module]]) validate/dedupe before the data enters [[user_finance_state (table)]].

- **Security invariant:** every provider registers `false` for payment-initiation/transfer/payout/order/mandate — read-only, enforced both in the adapter's capability report and by COBOL rejecting money-movement scope strings

Related: [[Bank Connection Flow]] · [[COBOL Domain Core]] · [[Reconciliation and Deduplication]]
