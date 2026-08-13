---
type: model
domain: ai
status: implemented
---

# Model: reasoning (local assistant)

- **Model ID:** `onnx-community/Qwen2.5-0.5B-Instruct`
- **Task:** text-generation · **Purpose:** local RAG answers, explanations, budget summaries, approval-gated planning
- **Runtime:** browser · **Load policy:** on-demand · **dtype:** q4 · **Loader:** transformers-js
- **Feature using it:** [[Finance Assistant Page]] — the on-device engine in [[Hosted-On-Device Routing Decision|Hosted/On-Device routing decision]]
- **Offline capability:** this IS the offline-capable path — see [[Offline AI Fallback Flow]]
- **Fallback:** if this model can't load, [[Finance Assistant Page]] falls back to deterministic local calculations, never silently to hosted
- **Consent requirement:** none (fully local)
- **License:** Apache-2.0

Related: [[AI Index]] · [[Finance Assistant Page]] · [[Offline AI Fallback Flow]] · [[Model Qwen3-4B-Thinking (hosted)]]
