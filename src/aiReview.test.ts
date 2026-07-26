import { describe, expect, it } from 'vitest'
import type { AiSuggestion } from './ai'
import { buildAiReviewSummary, isTrustedSuggestion, matchesAiReviewFilter } from './aiReview'

const suggestion = (overrides: Partial<AiSuggestion> = {}): AiSuggestion => ({
  category: 'Lebensmittel',
  merchant: 'REWE',
  confidence: 88,
  explanation: 'Test',
  recurringProbability: 20,
  anomalyScore: 15,
  alternatives: [],
  needsReview: false,
  source: 'ensemble',
  ...overrides,
})

describe('AI review queue', () => {
  it('separates trusted automation from human review', () => {
    const trusted = suggestion()
    const review = suggestion({ confidence: 52, needsReview: true })
    expect(isTrustedSuggestion(trusted)).toBe(true)
    expect(isTrustedSuggestion(review)).toBe(false)
    expect(matchesAiReviewFilter(review, 'review')).toBe(true)
    expect(matchesAiReviewFilter(trusted, 'trusted')).toBe(true)
  })

  it('summarizes confidence, recurring candidates, and anomalies', () => {
    const summary = buildAiReviewSummary({
      a: suggestion(),
      b: suggestion({ confidence: 60, needsReview: true, recurringProbability: 82 }),
      c: suggestion({ confidence: 72, anomalyScore: 91 }),
    })
    expect(summary).toEqual({
      analyzed: 3,
      trusted: 1,
      needsReview: 1,
      recurringCandidates: 1,
      anomalies: 1,
      averageConfidence: 73,
    })
  })
})
