---
type: data
domain: finance
status: implemented
---

# Transaction (data model)

Domain type in `src/domain/finance/types.ts`. Must reference an existing account (client- and server-validated); amounts are integer cents, normalized via [[Transaction Normalization]] for provider-synced data. Persisted as part of the encrypted payload in [[user_finance_state (table)]].

Related: [[Data Index]] · [[Transactions Page]] · [[Account (data model)]]
