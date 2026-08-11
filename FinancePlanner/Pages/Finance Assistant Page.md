---
type: page
domain: ai
status: implemented
---

# Finance Assistant (page)

Secondary nav, "Intelligence" group (`id: 'assistant'`). Conversational Q&A over the user's own financial snapshot, hosted/on-device/offline routed.

- **Component:** [[FinanceAssistant.tsx]]
- **Logic:** [[assistant.ts]] — `runAssistant()`, `runHostedAssistant()`
- **Routing decision:** [[Hosted-On-Device Routing Decision|Hosted/On-Device routing decision]] — connectivity-aware, not just manual choice
- **Consent gate:** [[AI Consent Gate]] — `consentExternalAi` must be explicitly true before any hosted call
- **Models:** hosted [[Model Qwen3-4B-Thinking (hosted)]], local [[Model reasoning]]
- **Related tests:** `src/FinanceAssistant.test.tsx`, `src/assistantFallback.test.ts`
- **Diagram:** `diagrams/ai-assistant-routing.mmd`
- **Verification state:** consent/routing/allowlist — implemented and CI-enforced; hosted inference — **gate-execution evidence only, not verified successful inference** ([[Hosted Hugging Face Inference]])

Related: [[AI System]] · [[Finance Intelligence Page]] · [[Hosted AI Request Flow]] · [[Offline AI Fallback Flow]]
