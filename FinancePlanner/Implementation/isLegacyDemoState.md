---
type: component
domain: data
status: implemented
---

# isLegacyDemoState

- **Location:** [[data.ts]]
- **Contract:** returns true **only** if every account, transaction, and goal exactly matches the canonical untouched starter dataset (every field, not just IDs), and no subscription exists
- **History:** originally matched by transaction-ID pattern + partial fields, which could misclassify a user-edited legacy transaction as untouched demo data and silently discard the edit. Hardened during PR #131's final review — see [[Debugging Learnings]].
- **Tests:** [[Legacy State Cleanup Tests]]

Related: [[Implementation Index]] · [[removeLegacyDemoState]] · [[Legacy-Demo-State Cleanup]]
