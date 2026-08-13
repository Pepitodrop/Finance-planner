---
type: model
domain: ai
status: implemented
---

# Model: graph-rag

- **Model ID:** `Xenova/multilingual-e5-small`
- **Task:** feature-extraction · **Purpose:** multilingual behavior-graph node embeddings and private financial-history retrieval
- **Runtime:** browser · **Load policy:** on-demand · **dtype:** q8 · **Loader:** transformers-js
- **Feature using it:** [[Finance Intelligence Page]] (behavior graph)
- **Backend counterpart:** `src/graphIntelligence.ts`, [[behavior-intelligence.js]]
- **Consent requirement:** none (fully local; private financial history never leaves the browser for this retrieval step)
- **License:** MIT

Related: [[AI Index]] · [[Finance Intelligence Page]]
