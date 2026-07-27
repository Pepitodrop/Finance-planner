import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/aiModels.ts', import.meta.url), 'utf8')

const requiredModels = [
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  'onnx-community/Qwen2.5-0.5B-Instruct',
]

for (const model of requiredModels) {
  assert.match(source, new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `Missing required AI model: ${model}`)
}

assert.match(source, /@huggingface\/transformers@\d+\.\d+\.\d+/, 'Transformers.js must be version-pinned')
assert.doesNotMatch(source, /api-inference\.huggingface\.co|InferenceClient|HF_TOKEN/, 'AI must not silently send finance data to hosted inference')
assert.match(source, /requires the optional server-side Python inference service/, 'Non-browser models need an explicit runtime boundary')
assert.match(source, /pipelines\.delete\(key\)/, 'Failed model loads must not poison the pipeline cache')
assert.match(source, /license:/, 'Every model needs declared license metadata')
assert.match(source, /enabledByDefault:/, 'Every model needs an explicit default-load policy')

console.log('AI production invariants verified.')
