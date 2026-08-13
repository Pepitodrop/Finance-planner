---
type: flow
domain: ai
status: implemented
---

# Offline AI Fallback Flow

`navigator.onLine === false`, OR the Network Information API reports a slow connection (`effectiveType` 2g/slow-2g, `downlink<1.25`, `rtt>=900`, `saveData`), OR [[MobileConnectivityStatus.tsx]]'s health-probe reports degraded/offline → hosted engine auto-disabled in the UI with an explicit reason shown → [[Hosted-On-Device Routing Decision|Hosted/On-Device routing decision]] routes to on-device [[Model reasoning]] → if the local model itself can't load, falls back further to deterministic local calculations, **never** silently calling the hosted service to compensate.

- **Measured:** during `/benchmark`, an offline-routing transition was measured with zero hidden hosted requests

Related: [[AI System]] · [[Sync and Offline]] · [[Hosted-On-Device Routing Decision]]
