import type { AppState, Account, Transaction } from './types'

// Removes exactly one financial account and every transaction referencing
// it, atomically -- Finance Planner's cloud-state validation requires every
// transaction.accountId to reference an existing account (see
// validateCloudPayload() in server/src/user-state-store.js and isAppState()
// in src/validation.ts), so an account can never be removed while any
// transaction still points at it. This is a pure domain helper, mirroring
// transactionState.ts's deleteTransactionFromState(), so Dashboard.tsx (and
// any future caller) never has to scatter the filter logic itself.
//
// Deliberately does NOT touch any provider connection: removing one
// provider-linked account must never disconnect/revoke the whole
// connection (a connection can have several accounts) -- see
// excludeProviderAccount() in connectors.ts for the separate, best-effort
// step that stops a removed provider account from being silently
// re-imported on the next sync.
export function removeAccountFromState(state: AppState, accountId: string): { state: AppState; deletedAccount: Account; deletedTransactions: Transaction[] } {
  const deletedAccount = state.accounts.find((account) => account.id === accountId)
  if (!deletedAccount) throw new Error('The account to remove was not found.')

  const deletedTransactions = state.transactions.filter((transaction) => transaction.accountId === accountId)
  return {
    deletedAccount,
    deletedTransactions,
    state: {
      ...state,
      accounts: state.accounts.filter((account) => account.id !== accountId),
      transactions: state.transactions.filter((transaction) => transaction.accountId !== accountId),
    },
  }
}

// Reverses removeAccountFromState() -- restores the account and its
// transactions exactly as they were. Only offered for MANUAL accounts (see
// Dashboard.tsx): a provider-linked account's removal also calls
// excludeProviderAccount() server-side, and undoing only the local state
// without also reversing that server-side exclusion would silently
// reintroduce the account into local state while the server keeps
// filtering it out of every future sync -- confusing and not attempted
// here. restoreAccountToState() itself is provider-agnostic; the decision
// not to offer it for provider accounts is a UI-layer one.
export function restoreAccountToState(state: AppState, account: Account, transactions: Transaction[]): AppState {
  return {
    ...state,
    accounts: [...state.accounts, account],
    transactions: [...transactions, ...state.transactions],
  }
}
