import { describe, expect, it } from 'vitest'
import { calibrateSemanticConfidence, robustAnomalyScore } from './ai'
import type { Transaction } from './types'

function expense(id: string, amountCents: number, category = 'Lebensmittel'): Transaction {
  return {
    id,
    accountId: 'checking',
    description: `Test ${id}`,
    category,
    type: 'expense',
    amountCents,
    date: `2026-01-${id.padStart(2, '0')}`,
    recurring: false,
  }
}

describe('calibrateSemanticConfidence', () => {
  it('requires both a strong score and separation from the runner-up', () => {
    expect(calibrateSemanticConfidence(0.78, 0.76)).toBeLessThan(70)
    expect(calibrateSemanticConfidence(0.78, 0.55)).toBeGreaterThan(80)
  })

  it('keeps weak semantic matches low confidence', () => {
    expect(calibrateSemanticConfidence(0.42, 0.30)).toBeLessThan(40)
  })
})

describe('robustAnomalyScore', () => {
  const history = [990, 1000, 1010, 1005, 995, 1000].map((amount, index) => expense(String(index + 1), amount))

  it('does not flag normal variation', () => {
    expect(robustAnomalyScore(1020, 'Lebensmittel', history)).toBeLessThan(35)
  })

  it('flags a material outlier against a stable history', () => {
    expect(robustAnomalyScore(5000, 'Lebensmittel', history)).toBeGreaterThan(90)
  })

  it('stays conservative when history is too small', () => {
    expect(robustAnomalyScore(5000, 'Lebensmittel', history.slice(0, 3))).toBe(15)
  })
})
