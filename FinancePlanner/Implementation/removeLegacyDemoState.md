---
type: component
domain: data
status: implemented
---

# removeLegacyDemoState

- **Location:** [[data.ts]]
- **Contract:** `isLegacyDemoState(state) ? structuredClone(emptyProductionState) : state` — only replaces state when [[isLegacyDemoState]] returns true; otherwise passes the state through untouched
- **Called from:** [[VaultGate.tsx]], once per unlock, right after sync, result persisted back via `saveState`

Related: [[Implementation Index]] · [[isLegacyDemoState]] · [[Vault Unlock Flow]]
