---
type: file
domain: backend
status: implemented
---

# server.js

- **Owns:** entrypoint, route wiring (mounts `auth-router.js`, `finance-router.js`, `budget-router.js`, `ai-router.js`, `google-subscriptions-router.js`), health endpoints (`/health/ready`, `/health/bank`), `revokeSession` wiring
- **Composes:** [[Backend]] as a whole
- **Depends on:** [[Node.js runtime]], [[HTTP-API Layer]]

Related: [[Implementation Index]] · [[Backend]] · [[System Architecture]]
