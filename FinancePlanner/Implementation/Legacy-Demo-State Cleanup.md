---
type: component
domain: data
status: implemented
---

# Legacy-Demo-State Cleanup (feature)

The user-facing outcome of [[isLegacyDemoState]]/[[removeLegacyDemoState]]: a real account that still carries the exact untouched pre-0.2.0 sample dataset gets it silently replaced with a genuinely empty state on next unlock; any user edit at all makes the account permanently ineligible for this cleanup.

- **Root fix location:** [[VaultGate.tsx]] setup path always starts from `structuredClone(emptyProductionState)`, never the old sample data, for genuinely new vaults
- **"Clear financial data":** the manual, explicit equivalent — [[DataTools.tsx]] / [[backup.ts]]-adjacent, never reseeds

Related: [[Implementation Index]] · [[isLegacyDemoState]] · [[Vault Setup]] · [[Data and Persistence]]
