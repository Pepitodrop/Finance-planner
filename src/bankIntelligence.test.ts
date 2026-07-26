import { describe, expect, it } from 'vitest'
import { assessBankImportQuality, suggestCategoryFromHistory } from './bankIntelligence'
import type { Transaction } from './types'

const transaction = (id: string, description: string, category: string): Transaction => ({
  id,
  accountId: 'account-1',
  description,
  category,
  type: 'expense',
  amountCents: 1299,
  date: '2026-07-01',
  recurring: false,
})

describe('bank import intelligence', () => {
  it('learns a category only from repeated, consistent merchant history', () => {
    const history = [
      transaction('1', 'REWE Markt Kartenzahlung 123456', 'Lebensmittel'),
      transaction('2', 'REWE Markt VISA 998877', 'Lebensmittel'),
      transaction('3', 'REWE Markt', 'Lebensmittel'),
    ]
    expect(suggestCategoryFromHistory('REWE Markt EC 445566', history)).toEqual({
      category: 'Lebensmittel',
      confidence: 100,
      evidenceCount: 3,
    })
  })

  it('rejects ambiguous history below the confidence threshold', () => {
    const history = [
      transaction('1', 'Amazon', 'Shopping'),
      transaction('2', 'Amazon', 'Freizeit'),
    ]
    expect(suggestCategoryFromHistory('Amazon', history)).toBeNull()
  })

  it('scores incomplete imports conservatively', () => {
    const imported = [
      transaction('1', 'REWE', 'Lebensmittel'),
      { ...transaction('2', 'DB', 'Unkategorisiert'), date: 'not-a-date' },
    ]
    const quality = assessBankImportQuality(imported, 1)
    expect(quality.score).toBeLessThan(70)
    expect(quality.smartCategorized).toBe(1)
    expect(quality.needsReview).toBeGreaterThan(0)
    expect(quality.warnings.length).toBeGreaterThan(0)
  })
})
