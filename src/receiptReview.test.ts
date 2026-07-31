import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatReceiptMoney,
  receiptConsentMatches,
  requestReceiptReview,
  shouldApplyReceiptResult,
  validateReceiptReviewResponse,
  type PreparedReceiptImage,
} from './receiptReview'

const response = {
  merchant: 'Testmarkt',
  totalCents: 549,
  currency: 'EUR',
  evidenceStatus: 'sufficient',
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
  model: { id: 'Qwen/Qwen2.5-VL-7B-Instruct:fastest', routing: 'hugging-face-provider-managed', license: 'Apache-2.0' },
  imageStored: false,
  generatedAt: '2026-07-31T18:00:00.000Z',
}

const preparedImage: PreparedReceiptImage = {
  mimeType: 'image/jpeg',
  dataBase64: '/9j/2Q==',
  previewUrl: 'data:image/jpeg;base64,/9j/2Q==',
  compressedBytes: 4,
}

afterEach(() => vi.unstubAllGlobals())

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

  it('accepts a fail-closed insufficient-evidence result without a score', () => {
    const result = validateReceiptReviewResponse({
      ...response,
      merchant: null,
      totalCents: null,
      evidenceStatus: 'insufficient',
      score: null,
      subScores: null,
      items: [],
      recommendations: [],
      confidence: 0.2,
    })
    expect(result.evidenceStatus).toBe('insufficient')
    expect(result.score).toBeNull()
    expect(result.items).toEqual([])
  })

  it('rejects recommendations attached to an insufficient-evidence result', () => {
    expect(() => validateReceiptReviewResponse({
      ...response,
      evidenceStatus: 'insufficient',
      score: null,
      subScores: null,
      items: [],
    })).toThrow(/keinen Score oder Empfehlungen/)
  })
})

describe('receipt request lifecycle', () => {
  it('binds consent to exactly one selected image', () => {
    expect(receiptConsentMatches(1, 1)).toBe(true)
    expect(receiptConsentMatches(2, 1)).toBe(false)
    expect(receiptConsentMatches(2, null)).toBe(false)
  })

  it('rejects stale or aborted responses', () => {
    expect(shouldApplyReceiptResult(3, 3, false)).toBe(true)
    expect(shouldApplyReceiptResult(2, 3, false)).toBe(false)
    expect(shouldApplyReceiptResult(3, 3, true)).toBe(false)
  })

  it('forwards the active abort signal to the receipt request', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal)
      return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await requestReceiptReview(preparedImage, controller.signal)
    expect(result.score).toBe(69)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('formatReceiptMoney', () => {
  it('formats cents and unknown values for German users', () => {
    expect(formatReceiptMoney(249)).toContain('2,49')
    expect(formatReceiptMoney(null)).toBe('nicht erkannt')
  })
})
