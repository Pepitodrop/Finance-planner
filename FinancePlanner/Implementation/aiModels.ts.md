---
type: file
domain: ai
status: implemented
---

# aiModels.ts

- **Owns:** `AI_MODELS` registry — all 7 local model definitions ([[AI Index]]), dynamically imports the vendored `/vendor/transformers-3.8.1.min.js` from the app origin (not a CDN, strict JS/WASM MIME types for CSP compatibility)

Related: [[Implementation Index]] · [[AI Model Selection]] · [[AI Index]]
