---
type: component
domain: ai
status: implemented
---

# AI Model Selection

Each capability (categorization, receipt extraction, forecasting, conversational reasoning...) maps to exactly one model in [[aiModels.ts]]'s `AI_MODELS` registry keyed by `AiModelKey`. Selection is capability-driven, not a general-purpose single-model design — see each [[AI Index|model node]] for its specific purpose.

Related: [[AI Index]] · [[aiModels.ts]]
