---
type: test
domain: ai
status: implemented
---

# AI Tests

- `src/ai.test.ts`, `src/aiQuality.test.ts`, `src/aiReview.test.ts`, `src/aiRuntimeReadiness.test.ts`, `src/aiEnsemble.test.ts`, `src/aiModels.test.ts`
- `src/assistantFallback.test.ts`, `src/FinanceAssistant.test.tsx`
- **`npm test` evaluation-gate chain:** `verify-ai.mjs`, `verify-ai-evaluation.mjs`, `verify-ai-quality-gates.mjs`, `verify-ai-model-lock.mjs` — numeric gates (macro F1 ≥0.85 categorization, merchant-normalization precision ≥0.90, 100% deterministic-monetary-answer match)

Related: [[Testing and CI Index]] · [[AI Index]] · [[AI System]]
