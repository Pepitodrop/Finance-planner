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
    return 'Sobald Transaktionen vorhanden sind, wird hier automatisch eine Finanzanalyse erstellt.'
  }

  const briefing = createSmartBriefing(state)
  if (briefing.length === 0) {
    return 'Die aktuellen Transaktionen wurden automatisch geprüft. Im laufenden Zeitraum wurden keine auffälligen Ausgabentrends, problematischen Fixkostenquoten oder akuten Liquiditätsrisiken erkannt.'
  }

  return [
    'Automatische Transaktionsanalyse',
    ...briefing.map((item) => `${item.title}: ${item.detail}`),
  ].join('\n\n')
}
