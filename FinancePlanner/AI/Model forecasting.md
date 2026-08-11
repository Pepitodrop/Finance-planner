---
type: model
domain: ai
status: implemented
---

# Model: forecasting

- **Model ID:** `ibm-granite/granite-timeseries-ttm-r2`
- **Task:** time-series-forecasting · **Purpose:** optional server-side cash-flow/spending forecasts with uncertainty bands
- **Runtime:** server (the only model that is server-side but not the hosted-HF path) · **Load policy:** on-demand · **dtype:** fp16 · **Loader:** python (the only non-`transformers-js` loader)
- **Distinct from hosted AI:** this runs as local server compute, not a call to Hugging Face's hosted API — no external provider involved
- **License:** Apache-2.0

Related: [[AI Index]] · [[AI System]]
