import { describe, expect, it } from 'vitest'
import { assessSmartness } from './smartness'
import type { AppState } from './types'

const state = (transactionCount: number, months = 1): AppState => ({
  accounts: [],
  goals: [{ id: 'g', name: 'Notgroschen', targetCents: 500000, currentCents: 50000, targetDate: '2027-01-01' }],
  transactions: Array.from({ length: transactionCount }, (_, index) => ({
    id: String(index),
    accountId: 'a',
    description: `Buchung ${index}`,
    category: ['Lebensmittel', 'Wohnen', 'Mobilität'][index % 3],
    type: 'expense' as const,
    amountCents: 1000 + index,
    date: `2026-${String((index % months) + 1).padStart(2, '0')}-01`,
    recurring: index % 5 === 0,
  })),
})

describe('AI smartness assessment', () => {
  it('improves with more history and confirmed learning', () => {
    const early = assessSmartness(state(5), 1)
    const mature = assessSmartness(state(60, 8), 20)
    expect(mature.overall).toBeGreaterThan(early.overall)
    expect(mature.dimensions.find((item) => item.key === 'prediction')?.score)
      .toBeGreaterThan(early.dimensions.find((item) => item.key === 'prediction')?.score ?? 0)
  })

  it('keeps safety, explainability, and model operations independently measurable', () => {
    const assessment = assessSmartness(state(0), 0)
    expect(assessment.dimensions.find((item) => item.key === 'safety')?.score).toBeGreaterThanOrEqual(80)
    expect(assessment.dimensions.find((item) => item.key === 'explainability')?.score).toBeGreaterThanOrEqual(80)
    expect(assessment.dimensions.find((item) => item.key === 'models')?.score).toBeGreaterThanOrEqual(90)
  })

  it('returns a concrete next milestone', () => {
    expect(assessSmartness(state(3), 0).nextMilestone.length).toBeGreaterThan(10)
  })
})
