import { describe, expect, it } from 'vitest'
import { formatReceiptMoney, validateReceiptReviewResponse } from './receiptReview'

const response = {
  merchant: 'Testmarkt',
  totalCents: 549,
  currency: 'EUR',
  score: 69,
  subScores: { affordability: 80, bioFairTrade: 60, eco: 70 },
  items: [{
    name: 'Bio Haferflocken',
    priceCents: 249,
    labels: { bio: true, fairTrade: null, regional: null, seasonal: null, packagingConcern: false },
    assessment: 'Bio ist auf dem Bon erkennbar.',
    cheaperAlternative: 'Eigenmarke vergleichen.',
    sustainableAlternative: 'Regionale Bio-Ware prüfen.',
    alternativeStores: ['Discounter', 'Bio-Supermarkt'],
    confidence: 0.8,
  }],
  recommendations: ['Siegel am Produkt verifizieren.'],
  limitations: ['Keine Live-Preise.'],
  confidence: 0.78,
  source: 'hugging-face-receipt-vision',
  model: { id: 'Qwen/Qwen2.5-VL-7B-Instruct:fastest', revision: 'b901af65fa3b2801b73d1c5b1ff59b89d81a708f', license: 'Apache-2.0' },
  imageStored: false,
  generatedAt: '2026-07-31T18:00:00.000Z',
}

describe('validateReceiptReviewResponse', () => {
  it('accepts a complete governed receipt result', () => {
    const result = validateReceiptReviewResponse(response)
    expect(result.score).toBe(69)
    expect(result.items[0].labels.bio).toBe(true)
    expect(result.imageStored).toBe(false)
  })

  it('rejects scores outside the supported range', () => {
    expect(() => validateReceiptReviewResponse({ ...response, score: 101 })).toThrow(/Gesamtscore/)
  })
})

describe('formatReceiptMoney', () => {
  it('formats cents and unknown values for German users', () => {
    expect(formatReceiptMoney(249)).toContain('2,49')
    expect(formatReceiptMoney(null)).toBe('nicht erkannt')
  })
})
