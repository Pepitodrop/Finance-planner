import { runDeterministicAssistant } from './assistant'
import type { AppState } from './types'

export const AUTOMATIC_TRANSACTION_ANALYSIS_PROMPT = 'Analysiere meine aktuellen Transaktionen automatisch. Priorisiere Ausgabentrends, Sparquote, wiederkehrende Belastungen, Liquidität und konkrete nächste Schritte.'

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
  return runDeterministicAssistant('analysis', state, AUTOMATIC_TRANSACTION_ANALYSIS_PROMPT)
}
