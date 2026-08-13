---
type: component
domain: ai
status: implemented
---

# AI Prompt Construction

The step that turns an [[AI Financial Snapshot]] plus the user's `intent` (mode + question, truncated to 500 chars client-side) into the actual model request, in [[huggingFaceClient.js]]/[[ai-router.js]].

- Not independently re-derived from the prompt-construction source line-by-line in this graph pass; the data-minimization *contract* is verified via the request-field allowlist (see [[AI Data Minimization]]), which is the enforceable boundary regardless of prompt wording.

Related: [[AI Index]] · [[AI Financial Snapshot]] · [[Hosted AI Request Flow]]
