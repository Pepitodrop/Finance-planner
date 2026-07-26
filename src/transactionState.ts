import type { AppState, Transaction } from './types'

function signedAmount(transaction: Transaction): number {
  return transaction.type === 'income' ? transaction.amountCents : -transaction.amountCents
}

function adjustAccountBalance(state: AppState, accountId: string, deltaCents: number): AppState {
  return {
    ...state,
    accounts: state.accounts.map((account) => account.id === accountId
      ? { ...account, balanceCents: account.balanceCents + deltaCents }
      : account),
  }
}

export function addTransactionToState(state: AppState, transaction: Transaction): AppState {
  const withBalance = adjustAccountBalance(state, transaction.accountId, signedAmount(transaction))
  return { ...withBalance, transactions: [transaction, ...state.transactions] }
}

export function updateTransactionInState(state: AppState, updated: Transaction): AppState {
  const previous = state.transactions.find((transaction) => transaction.id === updated.id)
  if (!previous) throw new Error('Die zu bearbeitende Transaktion wurde nicht gefunden.')

  let next = adjustAccountBalance(state, previous.accountId, -signedAmount(previous))
  next = adjustAccountBalance(next, updated.accountId, signedAmount(updated))
  return {
    ...next,
    transactions: next.transactions.map((transaction) => transaction.id === updated.id ? updated : transaction),
  }
}

export function deleteTransactionFromState(state: AppState, transactionId: string): { state: AppState; deleted: Transaction } {
  const deleted = state.transactions.find((transaction) => transaction.id === transactionId)
  if (!deleted) throw new Error('Die zu löschende Transaktion wurde nicht gefunden.')

  const next = adjustAccountBalance(state, deleted.accountId, -signedAmount(deleted))
  return {
    deleted,
    state: { ...next, transactions: next.transactions.filter((transaction) => transaction.id !== transactionId) },
  }
}
