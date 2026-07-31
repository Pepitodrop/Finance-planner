import { describe, expect, it, vi } from 'vitest'
import { calibrateSemanticConfidence, parseZeroShotResult, robustAnomalyScore, runZeroShotClassification } from './ai'
import type { ZeroShotClassifier } from './ai'
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

describe('zero-shot classification', () => {
  it('passes candidate labels separately from pipeline options', async () => {
    const mockClassifier = vi.fn(async () => ({ labels: ['Shopping'], scores: [0.81] }))
    const result = await runZeroShotClassification(mockClassifier as ZeroShotClassifier, 'Unbekannte Buchung')

    expect(result).toEqual({ category: 'Shopping', confidence: 81 })
    expect(mockClassifier).toHaveBeenCalledWith(
      'Unbekannte Buchung',
      expect.arrayContaining(['Lebensmittel', 'Shopping']),
      { hypothesis_template: 'Diese Buchung gehört zur Kategorie {}.' },
    )
  })

  it('rejects malformed or unsafe model output before it reaches React state', () => {
    expect(parseZeroShotResult({ labels: [{ candidate_labels: ['Shopping'] }], scores: [0.9] })).toBeNull()
    expect(parseZeroShotResult({ labels: ['Nicht vorhanden'], scores: [0.9] })).toBeNull()
    expect(parseZeroShotResult({ labels: ['Shopping'], scores: [Number.NaN] })).toBeNull()
    expect(parseZeroShotResult(null)).toBeNull()
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
