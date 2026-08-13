---
type: technology
domain: backend
status: implemented
---

# HTTP / API Layer

- **Where used:** router modules — [[auth-router.js]], [[finance-router.js]], [[budget-router.js]], [[ai-router.js]], [[google-subscriptions-router.js]] — sitting above the store layer
- **Contract discipline:** `GET/POST /api/finance/state` independently validates client- and server-side: rejects unknown fields, malformed IDs, invalid dates, non-integer money, duplicate IDs, orphaned transaction→account references, oversized payloads (10 MB cap on this route specifically, smaller general cap elsewhere)
- **Health endpoints:** `/health/ready` (core readiness only), `/health/bank` (automatic bank-monitoring capability, separate), `/healthz` (Nginx-level liveness, not proxied)

Related: [[Technology Index]] · [[Backend]] · [[Data and Persistence]]
