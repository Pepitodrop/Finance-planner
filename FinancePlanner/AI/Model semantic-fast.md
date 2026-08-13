---
type: model
domain: ai
status: implemented
---

# Model: semantic-fast

- **Model ID:** `Xenova/all-MiniLM-L6-v2`
- **Task:** feature-extraction · **Purpose:** fast English similarity, duplicate detection, merchant matching
- **Runtime:** browser · **Load policy:** on-demand · **dtype:** q8 · **Loader:** transformers-js
- **Fallback role:** faster/lighter alternative to [[Model semantic-multilingual]] for English-only matching
- **Consent requirement:** none (fully local)
- **Implementation:** [[aiModels.ts]]
- **License:** Apache-2.0

Related: [[AI Index]] · [[Model semantic-multilingual]]
