---
type: data
domain: finance
status: implemented
---

# Transaction (data model)

Domain type in `src/domain/finance/types.ts`. Must reference an existing account (client- and server-validated); amounts are integer cents, normalized via [[Transaction Normalization]] for provider-synced data. Persisted as part of the encrypted payload in [[user_finance_state (table)]].

- **`stableTransactionId?: string` (added 2026-08-27, PR #154):** a provider-agnostic identity for the same real economic transaction across a reconnect, distinct from `id` (this record's own local, provider-session-scoped identity). Derived server-side from a bank-assigned transaction reference namespaced under the owning account's `stableId` -- see [[Stable Account Identity and Reconnect Reconciliation]] for the full derivation and the fingerprint-collision bug it fixes.

Related: [[Data Index]] · [[Transactions Page]] · [[Account (data model)]] · [[Stable Account Identity and Reconnect Reconciliation]]
