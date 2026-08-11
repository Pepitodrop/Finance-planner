---
type: file
domain: frontend
status: implemented
---

# MobileConnectivityStatus.tsx

- **Owns:** the connectivity health-probe status machine; publishes its resolved status via a `finance-planner:connectivity` window event and a `data-finance-planner-connectivity` attribute on `<html>`
- **Consumed by:** [[Hosted-On-Device Routing Decision]] for AI routing, and its own offline/degraded banner across every page

Related: [[Implementation Index]] · [[Sync and Offline]] · [[Offline AI Fallback Flow]]
