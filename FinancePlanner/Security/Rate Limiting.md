---
type: security
domain: security
status: implemented
---

# Rate Limiting

Distributed sliding-window rate limiting via [[distributed-rate-limiter.js]] + [[request_rate_limits (table)]].

- **Known limitation:** IP-keyed, not per-account — architectural, pre-existing, deliberately deferred rather than a hardening-pass fix. `config/production-readiness-evidence.json`'s `distributedRateLimiting` gate is `partial`, not `verified` — no named accountable human `approvedBy` recorded (a repo-wide convention: a passing test alone doesn't upgrade a readiness gate to `verified`).

Related: [[Security Index]] · [[request_rate_limits (table)]] · [[Known Issues and Limitations]] · [[Rejected Approaches]]
