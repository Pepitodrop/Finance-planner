---
type: security
domain: ai
status: implemented
---

# AI Consent Gate

Explicit, per-request consent required before any aggregated financial data is sent to a hosted model.

- **Client-side:** [[assistant.ts]] — `runHostedAssistant()` throws before any hosted call if `consentExternalAi` is falsy
- **Server-side (independent, not trusting the client):** [[ai-router.js]] — throws `ai_consent_required` unless `consentExternalAi === true`, rejects any request-body field outside `['consentExternalAi', 'snapshot', 'intent']`
- **Separate gate:** behavior-learning requests have their own consent gate; behavior history must be loaded server-side, never client-supplied
- **Decision record:** [[Security Decisions]]

Related: [[AI Index]] · [[Hosted AI Request Flow]] · [[AI Data Minimization]] · [[Security System]]
