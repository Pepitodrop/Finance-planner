---
type: file
domain: ai
status: implemented
---

# ai-router.js

- **Owns:** server-side [[AI Consent Gate]] enforcement, request-field allowlist ([[AI Data Minimization]]), dispatch to [[huggingFaceClient.js]]
- **Independent of the client:** re-checks consent even if the client already checked — defense in depth

Related: [[Implementation Index]] · [[AI Consent Gate]] · [[Hosted Hugging Face Inference]]
