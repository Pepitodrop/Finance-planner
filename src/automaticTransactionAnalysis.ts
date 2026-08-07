import { createSmartBriefing } from './smartBriefing'
import type { AppState } from './types'

export function transactionAnalysisRevision(state: AppState): string {
  return state.transactions
    .map((transaction) => [
      transaction.id,
      transaction.accountId,
      transaction.date,
      transaction.type,
      transaction.amountCents,
      transaction.category,
      transaction.recurring ? 1 : 0,
    ].join(':'))
    .sort()
    .join('|')
}

export function createAutomaticTransactionAnalysis(state: AppState): string {
  if (state.transactions.length === 0) {
    return 'A financial analysis will be created here automatically once transactions exist.'
  }

  const briefing = createSmartBriefing(state)
  if (briefing.length === 0) {
    return 'Your current transactions were checked automatically. No unusual spending trends, problematic recurring-cost shares, or acute liquidity risks were found for the current period.'
  }

  return [
    'Automatic transaction analysis',
    ...briefing.map((item) => `${item.title}: ${item.detail}`),
  ].join('\n\n')
}
