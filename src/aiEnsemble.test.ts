import { describe, expect, it } from 'vitest'
import { resolveEnsembleDecision } from './ai'

describe('Hugging Face ensemble', () => {
  it('boosts confidence when independent models agree', () => {
    const decision = resolveEnsembleDecision(
      { category: 'Lebensmittel', confidence: 61 },
      { category: 'Lebensmittel', confidence: 78 },
    )

    expect(decision.category).toBe('Lebensmittel')
    expect(decision.source).toBe('ensemble')
    expect(decision.confidence).toBeGreaterThan(70)
    expect(decision.needsReview).toBe(false)
  })

  it('caps confidence and asks for review when models disagree', () => {
    const decision = resolveEnsembleDecision(
      { category: 'Shopping', confidence: 65 },
      { category: 'Freizeit', confidence: 69 },
    )

    expect(decision.confidence).toBeLessThanOrEqual(57)
    expect(decision.needsReview).toBe(true)
  })

  it('does not invoke imaginary consensus when the specialist is unavailable', () => {
    const decision = resolveEnsembleDecision({ category: 'Wohnen', confidence: 72 }, null)
    expect(decision).toEqual({ category: 'Wohnen', confidence: 72, source: 'hugging-face', needsReview: false })
  })
})
