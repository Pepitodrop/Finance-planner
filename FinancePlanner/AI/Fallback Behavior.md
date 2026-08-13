---
type: component
domain: ai
status: implemented
---

# Fallback Behavior (AI)

Two independent fallback layers, neither of which silently escalates to a less-private option:

1. **Hosted response invalid/unavailable** → deterministic local rules (not a retry against a different hosted model).
2. **Local model can't load** → deterministic local calculations, never a silent hosted call to compensate.

Related: [[AI Index]] · [[AI Response Schema]] · [[Offline AI Fallback Flow]] · [[Manual-Degraded Mode]]
