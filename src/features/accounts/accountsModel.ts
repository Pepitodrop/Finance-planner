import type { Account, AccountType, Transaction } from '../../types'

export type AccountFilter = 'all' | AccountType

export function accountLiabilityCents(account: Account) {
  if (account.type !== 'credit-card') return 0
  if (Number.isInteger(account.creditCard?.amountOwedCents)) return Math.max(0, account.creditCard!.amountOwedCents)
  return account.balanceCents < 0 ? Math.abs(account.balanceCents) : 0
}

export function summarizeAccounts(accounts: Account[]) {
  const assetsCents = accounts.reduce((sum, account) => account.type === 'credit-card' ? sum : sum + account.balanceCents, 0)
  const liabilitiesCents = accounts.reduce((sum, account) => sum + accountLiabilityCents(account), 0)
  return { assetsCents, liabilitiesCents, netWorthCents: assetsCents - liabilitiesCents }
}

export function filterAccounts(accounts: Account[], filter: AccountFilter) {
  return accounts.filter((account) => filter === 'all' || account.type === filter)
}

export function transactionsForAccount(transactions: Transaction[], accountId: string) {
  return transactions.filter((transaction) => transaction.accountId === accountId).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
}

export type DueDateStatus = 'none' | 'invalid' | 'future' | 'due-today' | 'overdue'
export function classifyDueDate(value: string | undefined, referenceDate: Date): DueDateStatus {
  if (!value) return 'none'
  const due = new Date(`${value}T12:00:00`)
  if (Number.isNaN(due.getTime())) return 'invalid'
  const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate(), 12)
  return due.getTime() < today.getTime() ? 'overdue' : due.getTime() === today.getTime() ? 'due-today' : 'future'
}
