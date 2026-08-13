---
type: model
domain: ai
status: implemented
---

# Model: receipt

- **Model ID:** `Xenova/donut-base-finetuned-cord-v2`
- **Task:** image-to-text · **Purpose:** on-device receipt and invoice field extraction
- **Runtime:** browser · **Load policy:** on-demand · **dtype:** fp16 · **Loader:** transformers-js
- **Feature using it:** [[Receipt Review Page]]
- **Privacy:** receipt images never leave the device for this extraction step
- **License:** Apache-2.0
- **Note:** `config/ai-model-lock.json` separately lists `microsoft/Florence-2-base` for the `receipt-extraction` capability — a different model ID than this runtime registry entry. Not resolved by this graph update; recorded as a factual observation, not a claim about which manifest is authoritative — see [[AI Model Allowlist]].

Related: [[AI Index]] · [[Receipt Review Page]]
