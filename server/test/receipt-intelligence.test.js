import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RECEIPT_EVIDENCE_POLICY,
  RECEIPT_MODEL,
  createReceiptReviewer,
  scoreReceiptSubScores,
  validateReceiptModelResult,
  validateReceiptReviewInput,
} from '../src/receipt-intelligence.js'

const jpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64')

const validInput = {
  consentExternalAi: true,
  image: { mimeType: 'image/jpeg', dataBase64: jpegBase64 },
  preferences: { country: 'DE', priorities: ['bio', 'fairTrade', 'eco', 'price'] },
}

const modelResult = {
  merchant: 'Testmarkt',
  totalCents: 549,
  currency: 'EUR',
  subScores: { affordability: 80, bioFairTrade: 60, eco: 70 },
  items: [{
    name: 'Bio Haferflocken',
    priceCents: 249,
    labels: { bio: true, fairTrade: null, regional: null, seasonal: null, packagingConcern: false },
    assessment: 'Bio ist erkennbar; weitere Nachhaltigkeitssiegel sind auf dem Bon nicht belegt.',
    cheaperAlternative: 'Eigenmarke derselben Produktgruppe vergleichen.',
    sustainableAlternative: 'Regional erzeugte Bio-Haferflocken in Papierverpackung prüfen.',
    alternativeStores: ['Discounter', 'Bio-Supermarkt'],
    confidence: 0.8,
  }],
  recommendations: ['Bio- und Fairtrade-Siegel direkt am Produkt verifizieren.'],
  limitations: [],
  confidence: 0.78,
}

test('validates a compressed JPEG receipt and priorities', () => {
  const result = validateReceiptReviewInput(validInput)
  assert.equal(result.image.byteLength, 4)
  assert.deepEqual(result.preferences.priorities, ['bio', 'fairTrade', 'eco', 'price'])
})

test('rejects declared image types that do not match the bytes', () => {
  assert.throws(() => validateReceiptReviewInput({
    ...validInput,
    image: { mimeType: 'image/png', dataBase64: jpegBase64 },
  }), /does not match/i)
})

test('computes the weighted sustainability score deterministically', () => {
  assert.deepEqual(scoreReceiptSubScores({ affordability: 80, bioFairTrade: 60, eco: 70 }), {
    subScores: { affordability: 80, bioFairTrade: 60, eco: 70 },
    score: 69,
  })
})

test('adds the mandatory live-price limitation to a sufficiently grounded result', () => {
  const result = validateReceiptModelResult(modelResult)
  assert.equal(result.evidenceStatus, 'sufficient')
  assert.equal(result.score, 69)
  assert.equal(result.items[0].labels.bio, true)
  assert.ok(result.limitations.some((entry) => /Live-Preis/i.test(entry)))
})

test('abstains when no reliable priced items were extracted, even if the model supplied high scores', () => {
  const result = validateReceiptModelResult({
    ...modelResult,
    items: [],
    confidence: 0.99,
  })
  assert.equal(result.evidenceStatus, 'insufficient')
  assert.equal(result.score, null)
  assert.equal(result.subScores, null)
  assert.deepEqual(result.items, [])
  assert.deepEqual(result.recommendations, [])
  assert.equal(result.merchant, null)
  assert.ok(result.limitations.some((entry) => /nicht zuverlässig/i.test(entry)))
})

test('abstains when overall confidence is below the reviewed threshold', () => {
  const result = validateReceiptModelResult({
    ...modelResult,
    confidence: RECEIPT_EVIDENCE_POLICY.minOverallConfidence - 0.01,
  })
  assert.equal(result.evidenceStatus, 'insufficient')
  assert.equal(result.score, null)
})

test('uses provider-managed Hugging Face routing without claiming an immutable served revision', async () => {
  let requestBody
  let requestHeaders
  const reviewer = createReceiptReviewer({
    env: { HF_TOKEN: 'hf-test-token' },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      requestHeaders = options.headers
      return {
        ok: true,
        async json() { return { choices: [{ message: { content: JSON.stringify(modelResult) } }] } },
      }
    },
  })

  const result = await reviewer(validInput)
  assert.equal(requestBody.model, RECEIPT_MODEL.model)
  assert.equal('revision' in requestBody, false)
  assert.equal('x-hf-model-revision' in requestHeaders, false)
  assert.match(requestBody.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,/)
  assert.equal(result.score, 69)
  assert.equal(result.imageStored, false)
  assert.equal(result.model.license, 'Apache-2.0')
  assert.equal(result.model.routing, 'hugging-face-provider-managed')
  assert.equal('revision' in result.model, false)
})
