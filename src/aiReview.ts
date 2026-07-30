import type { AiSuggestion } from './ai'

export type AiReviewFilter = 'all' | 'trusted' | 'review' | 'recurring' | 'anomaly'

export interface AiReviewSummary {
  analyzed: number
  trusted: number
  needsReview: number
  recurringCandidates: number
  anomalies: number
  averageConfidence: number
}

export function isTrustedSuggestion(suggestion: AiSuggestion): boolean {
  return suggestion.confidence >= 80 && !suggestion.needsReview && suggestion.category !== 'Sonstiges'
}

export function requiresHumanReview(suggestion: AiSuggestion): boolean {
  return !isTrustedSuggestion(suggestion)
}

export function pendingTrustedSuggestionIds(
  transactionIds: readonly string[],
  suggestions: Record<string, AiSuggestion>,
  appliedIds: ReadonlySet<string>,
): string[] {
  return transactionIds.filter((transactionId) => {
    const suggestion = suggestions[transactionId]
    if (!suggestion || appliedIds.has(transactionId)) return false
    return isTrustedSuggestion(suggestion)
  })
}

export function buildAiReviewSummary(suggestions: Record<string, AiSuggestion>): AiReviewSummary {
  const values = Object.values(suggestions)
  const analyzed = values.length
  return {
    analyzed,
    trusted: values.filter(isTrustedSuggestion).length,
    needsReview: values.filter(requiresHumanReview).length,
    recurringCandidates: values.filter((item) => item.recurringProbability >= 75).length,
    anomalies: values.filter((item) => item.anomalyScore >= 70).length,
    averageConfidence: analyzed
      ? Math.round(values.reduce((sum, item) => sum + item.confidence, 0) / analyzed)
      : 0,
  }
}

export function matchesAiReviewFilter(suggestion: AiSuggestion | undefined, filter: AiReviewFilter): boolean {
  if (filter === 'all') return true
  if (!suggestion) return false
  if (filter === 'trusted') return isTrustedSuggestion(suggestion)
  if (filter === 'review') return requiresHumanReview(suggestion)
  if (filter === 'recurring') return suggestion.recurringProbability >= 75
  return suggestion.anomalyScore >= 70
}
