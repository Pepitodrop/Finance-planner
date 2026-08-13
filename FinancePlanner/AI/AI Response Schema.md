---
type: component
domain: ai
status: implemented
---

# AI Response Schema

Hosted-model output is required to be structured JSON matching a defined schema, not free text trusted directly.

- **Validated for:** signal types (predefined, closed set), evidence, confidence (clamped 0–1), text lengths, approval requirements
- **On validation failure:** falls back to deterministic rules — [[Fallback Behavior]]
- **Enforced in:** [[ai-router.js]] / [[huggingFaceClient.js]]
- **Safety property:** model output can never override deterministic balances or transaction totals ([[COBOL Domain Core]])

Related: [[AI Index]] · [[Hosted AI Request Flow]] · [[Fallback Behavior]]
