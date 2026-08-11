---
type: data
domain: finance
status: implemented
---

# Account (data model)

Domain type in `src/domain/finance/types.ts`, framework-independent. Includes manual accounts and provider-linked accounts (normalized through [[Balance Normalization]] before entering state). Persisted as part of the encrypted payload in [[user_finance_state (table)]], never as a separate unencrypted table.

Related: [[Data Index]] · [[Accounts Page]] · [[Transaction (data model)]]
