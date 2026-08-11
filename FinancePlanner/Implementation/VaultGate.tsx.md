---
type: file
domain: data
status: implemented
---

# VaultGate.tsx

- **Owns:** both [[Vault Setup]] and [[Vault Unlock]] (mode-dependent), runs [[isLegacyDemoState]]/[[removeLegacyDemoState]] once per unlock
- **Coexists with:** [[Passkey Enrolment Banner]] — structurally, not via suppression (see [[Debugging Learnings]])

Related: [[Implementation Index]] · [[Vault Setup]] · [[Vault Unlock]]
