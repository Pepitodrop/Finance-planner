---
type: model
domain: ai
status: implemented
---

# Model: semantic-multilingual

- **Model ID:** `Xenova/paraphrase-multilingual-MiniLM-L12-v2`
- **Task:** feature-extraction · **Purpose:** multilingual transaction categorization and semantic similarity
- **Runtime:** browser, on-device · **Load policy:** startup (only model loaded automatically) · **dtype:** q8 · **Loader:** transformers-js
- **Feature using it:** [[Finance Intelligence Page]] (categorization)
- **Input/output:** transaction text in → embedding vector out; never leaves the browser
- **Consent requirement:** none (fully local)
- **Implementation:** [[aiModels.ts]]
- **License:** Apache-2.0
- **Verification state:** implemented; runtime load-success-rate not independently re-measured this session — see [[Provider Status]]

Related: [[AI Index]] · [[Finance Intelligence Page]] · [[Provider Status]]
