---
type: component
domain: ai
status: implemented
---

# Hosted/On-Device Routing Decision

The connectivity-aware policy in [[FinanceAssistant.tsx]] that picks the AI engine — not just the user's manual choice.

Decision order:
1. `navigator.onLine === false` → force on-device.
2. Network Information API reports slow (`2g`/`slow-2g`, `downlink<1.25`, `rtt>=900`, `saveData`) → force on-device.
3. [[MobileConnectivityStatus.tsx]]'s health-probe status (`finance-planner:connectivity` event) reports offline/degraded → force on-device.
4. Otherwise: hosted is the default while online; the user may still manually pick on-device.

During automatic fallback, the hosted engine card is disabled in the UI with an explicit reason shown — never a silent switch.

- **Diagram:** `diagrams/ai-assistant-routing.mmd`
- **Measured:** `/benchmark` confirmed zero hidden hosted requests during an offline-routing transition

Related: [[AI Index]] · [[Offline AI Fallback Flow]] · [[Hosted AI Request Flow]] · [[Sync and Offline]]
