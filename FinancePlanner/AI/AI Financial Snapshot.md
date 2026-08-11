---
type: data
domain: ai
status: implemented
---

# AI Financial Snapshot

The aggregated data shape sent to hosted AI — the only representation of a user's finances that ever leaves the device for AI purposes.

- **Built by:** the browser or the trusted backend, aggregating over the user's finance state
- **Excludes:** raw merchant descriptions, account names, transaction IDs, credentials
- **Consumed by:** [[Model Qwen3-4B-Thinking (hosted)]] via [[ai-router.js]]
- **Bounded by:** [[AI Data Minimization]], [[AI Consent Gate]]

Related: [[AI Index]] · [[Hosted AI Request Flow]] · [[AI Prompt Construction]]
