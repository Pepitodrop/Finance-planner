---
type: security
domain: ai
status: implemented
---

# AI Model Allowlist

`server/src/ai-ensemble.js` maintains a frozen `REVIEWED_MODEL_REVISIONS` allowlist per role (analyst/critic); `reviewedModel()` throws at runtime for anything not on it — a hard block, not just a documentation convention.

- **Two manifests exist:** `config/ai-model-lock.json` (governance-facing, 4 entries, `productionEnabled: false` on all, revisions marked `PIN_REQUIRED_BEFORE_PRODUCTION`) and the runtime registry in [[aiModels.ts]] (8 entries including [[Model Qwen3-4B-Thinking (hosted)]]). Model IDs between the two do not fully match for the receipt-extraction and relationship-prediction capabilities — recorded factually here, not resolved or guessed at.

Related: [[AI Index]] · [[AI Model Revision Locking]] · [[ai-ensemble.js]]
