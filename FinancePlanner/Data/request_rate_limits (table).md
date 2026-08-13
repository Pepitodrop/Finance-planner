---
type: database
domain: data
status: implemented
---

# request_rate_limits (table)

- **Migration:** `005_request_rate_limits.sql`
- **Contains:** distributed sliding-window rate-limit counters
- **Store/repository:** [[distributed-rate-limiter.js]]
- **Retention:** [[retention.js]] purges expired windows
- **Known limitation:** IP-keyed, not per-account — architectural, pre-existing, deliberately deferred hardening ([[Known Issues and Limitations]])

Related: [[Data Index]] · [[Rate Limiting]] · [[distributed-rate-limiter.js]]
