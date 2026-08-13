---
type: component
domain: ai
status: implemented
---

# Manual / Degraded Mode (AI)

The user-visible state when the hosted engine is unavailable or disabled: the UI explicitly names the reason ("Using the on-device path... Hosted AI is paused until connectivity recovers") rather than degrading silently. Distinct from a hard error — the assistant remains fully usable via [[Model reasoning]] or deterministic fallback.

Related: [[AI Index]] · [[Fallback Behavior]] · [[Hosted-On-Device Routing Decision]]
