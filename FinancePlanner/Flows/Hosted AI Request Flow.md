---
type: flow
domain: ai
status: partial
---

# Hosted AI Request Flow

[[Finance Assistant Page]] → user asks a question, hosted engine selected (default while online) → [[AI Consent Gate]] checked client-side (`assistant.ts`) → request sent with `{ consentExternalAi, intent, snapshot }` only → [[ai-router.js]] re-checks consent server-side and rejects any field outside the allowlist → [[Hosted Hugging Face Inference]] called with only the aggregated [[AI Financial Snapshot]] (no raw descriptions/account names/IDs) → structured JSON validated against [[AI Response Schema]] → malformed/unavailable output triggers deterministic fallback, never a silent hosted retry loop.

- **Verification state:** consent/allowlist/schema-validation — implemented and enforced; **hosted inference success itself is not runtime-verified** — GitHub Actions `hosted-ai-acceptance.yml` run recorded `status: blocked_by_credentials`

Related: [[AI System]] · [[Hosted Hugging Face Inference]] · [[AI Consent Gate]]
