import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/aiModels.ts', import.meta.url), 'utf8')
const assistantSource = await readFile(new URL('../src/assistant.ts', import.meta.url), 'utf8')
const vendorSource = await readFile(new URL('./vendor-transformers-runtime.mjs', import.meta.url), 'utf8')
const nginxSource = await readFile(new URL('../deploy/nginx.conf', import.meta.url), 'utf8')

const requiredModels = [
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  'onnx-community/Qwen2.5-0.5B-Instruct',
]

for (const model of requiredModels) {
  assert.match(source, new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Missing required AI model: ${model}`)
}

assert.match(source, /\/vendor\/transformers-3\.8\.1\.min\.js/, 'Categorisation must load the pinned same-origin Transformers.js runtime')
assert.match(assistantSource, /\/vendor\/transformers-3\.8\.1\.min\.js/, 'Assistant must load the pinned same-origin Transformers.js runtime')
assert.doesNotMatch(`${source}\n${assistantSource}`, /cdn\.jsdelivr\.net|unpkg\.com/, 'Browser AI runtime scripts must not execute from a third-party CDN')
assert.match(vendorSource, /@huggingface\/transformers@3\.8\.1/, 'Transformers.js package must be version-pinned')
assert.match(vendorSource, /onnxruntime-web@\$\{ONNX_RUNTIME_PACKAGE_VERSION\}/, 'ONNX Runtime package must be version-pinned')
assert.match(vendorSource, /EXPECTED_TRANSFORMERS_PACKAGE_INTEGRITY/, 'Transformers.js package integrity must be verified')
assert.match(vendorSource, /EXPECTED_ONNX_RUNTIME_PACKAGE_INTEGRITY/, 'ONNX Runtime package integrity must be verified')
assert.match(vendorSource, /wasmPaths = '\/vendor\//, 'ONNX Runtime WASM assets must be configured for the app origin')
assert.match(nginxSource, /location \^~ \/vendor\/ \{[\s\S]*application\/javascript js mjs;[\s\S]*application\/wasm wasm;[\s\S]*default_type application\/octet-stream;/, 'Vendored AI modules must be served with explicit JavaScript and WebAssembly MIME types')
assert.doesNotMatch(source, /api-inference\.huggingface\.co|InferenceClient|HF_TOKEN/, 'AI must not silently send finance data to hosted inference')
assert.match(source, /requires the optional server-side Python inference service/, 'Non-browser models need an explicit runtime boundary')
assert.match(source, /pipelines\.delete\(key\)/, 'Failed model loads must not poison the pipeline cache')
assert.match(source, /license:/, 'Every model needs declared license metadata')
assert.match(source, /enabledByDefault:/, 'Every model needs an explicit default-load policy')

console.log('AI production invariants verified.')
