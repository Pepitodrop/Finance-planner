import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiRouter } from '../src/ai-router.js'

const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')
const receiptInput = {
  consentExternalAi: true,
  image: { mimeType: 'image/jpeg', dataBase64: jpegBase64 },
  preferences: { country: 'DE', priorities: ['bio', 'fairTrade', 'eco', 'price'] },
}

const send = () => {}
const receiptUrl = new URL('http://localhost/api/ai/receipt-review')

test('receipt review requires authentication before reading the image body', async () => {
  let bodyRead = false
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' },
    send,
    body: async () => { bodyRead = true; return receiptInput },
    userId: () => { throw new Error('Authentication required.') },
  })
  await assert.rejects(() => router({ method: 'POST' }, {}, receiptUrl), /Authentication required/)
  assert.equal(bodyRead, false)
})

test('receipt review requires explicit consent before contacting Hugging Face', async () => {
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' },
    send,
    body: async () => ({ ...receiptInput, consentExternalAi: false }),
    userId: () => 'user-1',
  })
  await assert.rejects(() => router({ method: 'POST' }, {}, receiptUrl), (error) => error.code === 'ai_consent_required')
})

test('receipt review rejects unsupported files before contacting Hugging Face', async () => {
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' },
    send,
    body: async () => ({ ...receiptInput, image: { mimeType: 'application/pdf', dataBase64: jpegBase64 } }),
    userId: () => 'user-1',
  })
  await assert.rejects(() => router({ method: 'POST' }, {}, receiptUrl), (error) => error.code === 'unsupported_receipt_image')
})
