---
type: database
domain: data
status: implemented
---

# webhook_events (table)

- **Contains:** webhook lease/idempotency records (provider webhook delivery, e.g. PayPal partner mode)
- **Store/repository:** [[postgres-store.js]] — lease-token pattern (`completed_at IS NULL` guards in-flight duplicates from being double-acknowledged)
- **Retention:** [[retention.js]] purges completed and abandoned webhook rows separately
- **Security:** [[webhook-security.js]] handles signature/idempotency verification before a row is trusted

Related: [[Data Index]] · [[PayPal]] · [[webhook-security.js]]
