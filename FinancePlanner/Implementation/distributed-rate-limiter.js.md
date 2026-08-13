---
type: file
domain: security
status: implemented
---

# distributed-rate-limiter.js

- **Owns:** Postgres-backed sliding-window rate limiting against [[request_rate_limits (table)]]
- **Known limitation:** IP-keyed, not per-account — see [[Rate Limiting]]

Related: [[Implementation Index]] · [[Rate Limiting]] · [[request_rate_limits (table)]]
