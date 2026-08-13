---
type: technology
domain: infrastructure
status: implemented
---

# Nginx

- **Where used:** `deploy/nginx.conf`, `deploy/security-headers.conf` — serves the built SPA, proxies `/health/ready`, `/health/live`, `/api/finance/state` (10 MB cap + extended timeouts) to the connector; `/healthz` served directly (fast liveness, not proxied)
- **PR #131 fix:** added the missing `/health/live` proxy block — its absence caused a false "can't reach the app service" banner (SPA fallback returned HTML where JSON was expected) — see [[Sync and Offline]]

Related: [[Technology Index]] · [[Deployment]] · [[Sync and Offline]]
