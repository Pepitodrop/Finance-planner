---
type: data
domain: finance
status: implemented
---

# Account (data model)

Domain type in `src/domain/finance/types.ts`, framework-independent. Includes manual accounts and provider-linked accounts (normalized through [[Balance Normalization]] before entering state). Persisted as part of the encrypted payload in [[user_finance_state (table)]], never as a separate unencrypted table.

- **`stableId?: string` (added 2026-08-27, PR #154):** a provider-agnostic identity for the same real-world account across separate sessions/consents, distinct from `externalId` (session-scoped, expected to change on reauthorization). Server-derived only, never a raw IBAN/account number. See [[Stable Account Identity and Reconnect Reconciliation]] for the full derivation, reconciliation algorithm, and the live reconnect-duplication bug it fixes.

Related: [[Data Index]] · [[Accounts Page]] · [[Transaction (data model)]] · [[Stable Account Identity and Reconnect Reconciliation]]
