import { describe, expect, it } from 'vitest'
import type { AiSuggestion } from './ai'
import { buildAiReviewSummary, isTrustedSuggestion, matchesAiReviewFilter, pendingTrustedSuggestionIds, requiresHumanReview } from './aiReview'

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
  it('separates trusted automation from every human-review case', () => {
    const trusted = suggestion()
    const modelReview = suggestion({ confidence: 52, needsReview: true })
    const belowAutomationThreshold = suggestion({ confidence: 72, needsReview: false })
    expect(isTrustedSuggestion(trusted)).toBe(true)
    expect(isTrustedSuggestion(modelReview)).toBe(false)
    expect(requiresHumanReview(belowAutomationThreshold)).toBe(true)
    expect(matchesAiReviewFilter(modelReview, 'review')).toBe(true)
    expect(matchesAiReviewFilter(belowAutomationThreshold, 'review')).toBe(true)
    expect(matchesAiReviewFilter(trusted, 'trusted')).toBe(true)
  })

  it('summarizes confidence, recurring candidates, anomalies, and policy review cases', () => {
    const summary = buildAiReviewSummary({
      a: suggestion(),
      b: suggestion({ confidence: 60, needsReview: true, recurringProbability: 82 }),
      c: suggestion({ confidence: 72, anomalyScore: 91 }),
    })
    expect(summary).toEqual({
      analyzed: 3,
      trusted: 1,
      needsReview: 2,
      recurringCandidates: 1,
      anomalies: 1,
      averageConfidence: 73,
    })
  })

  it('returns only trusted suggestions that have not already been applied', () => {
    const suggestions = {
      a: suggestion(),
      b: suggestion({ confidence: 60, needsReview: true }),
      c: suggestion({ merchant: 'Lidl' }),
      stale: suggestion(),
    }

    expect(pendingTrustedSuggestionIds(['a', 'b', 'c'], suggestions, new Set(['a']))).toEqual(['c'])
  })
})
