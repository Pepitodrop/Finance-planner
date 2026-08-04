import assert from 'node:assert/strict'
import test from 'node:test'
import { hostedAiCapabilities } from '../src/ai-capabilities.js'

test('hosted AI capabilities fail closed without credentials', () => {
  const result = hostedAiCapabilities({})
  assert.equal(result.provider, 'hugging-face-inference-providers')
  assert.equal(result.ready, false)
  assert.equal(result.tokenConfigured, false)
  assert.equal(result.financial.reason, 'missing_hf_token')
  assert.equal(result.receipt.reason, 'missing_hf_token')
  assert.equal(JSON.stringify(result).includes('token'), true)
  assert.equal(JSON.stringify(result).includes('hf_'), false)
})

test('hosted text and receipt inference report ready with reviewed production configuration', () => {
  const result = hostedAiCapabilities({
    HF_TOKEN: 'hf-secret-value',
    HF_MODEL: 'Qwen/Qwen3-4B-Thinking-2507:fastest',
    HF_MODEL_REVISION: '768f209d9ea81521153ed38c47d515654e938aea',
    HF_RECEIPT_MODEL: 'Qwen/Qwen2.5-VL-7B-Instruct:fastest',
    HF_TIMEOUT_MS: '30000',
    HF_RECEIPT_TIMEOUT_MS: '45000',
    HF_LIVE_VERIFIED_AT: '2026-08-04T18:00:00.000Z',
  })
  assert.equal(result.ready, true)
  assert.equal(result.financial.ready, true)
  assert.equal(result.receipt.ready, true)
  assert.equal(result.receipt.imageStored, false)
  assert.deepEqual(result.liveVerification, { verified: true, verifiedAt: '2026-08-04T18:00:00.000Z' })
  assert.equal(JSON.stringify(result).includes('hf-secret-value'), false)
})

test('invalid model configuration cannot be reported ready', () => {
  const result = hostedAiCapabilities({
    HF_TOKEN: 'configured',
    HF_MODEL_REVISION: 'latest',
    HF_RECEIPT_MODEL: 'unreviewed/model',
  })
  assert.equal(result.ready, false)
  assert.equal(result.financial.reason, 'invalid_financial_model_configuration')
  assert.equal(result.receipt.reason, 'invalid_receipt_model_configuration')
})
