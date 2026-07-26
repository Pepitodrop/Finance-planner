import type { AppState, Transaction } from './types'

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export function totalBalance(state: AppState): number {
  return state.accounts.reduce((sum, account) => sum + account.balanceCents, 0)
}

export function currentMonthTotals(transactions: Transaction[]) {
  const currentMonth = '2026-07'
  return transactions
    .filter((transaction) => transaction.date.startsWith(currentMonth))
    .reduce(
      (totals, transaction) => {
        if (transaction.type === 'income') totals.incomeCents += transaction.amountCents
        else totals.expenseCents += transaction.amountCents
        return totals
      },
      { incomeCents: 0, expenseCents: 0 },
    )
}

export function monthlyProjection(state: AppState, months = 12) {
  const recurring = state.transactions.filter((transaction) => transaction.recurring)
  const recurringIncome = recurring
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + transaction.amountCents, 0)
  const recurringExpenses = recurring
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + transaction.amountCents, 0)

  const discretionaryExpenses = state.transactions
    .filter((transaction) => transaction.type === 'expense' && !transaction.recurring)
    .reduce((sum, transaction) => sum + transaction.amountCents, 0)

  const monthlyNet = recurringIncome - recurringExpenses - discretionaryExpenses
  const startingBalance = totalBalance(state)

  return Array.from({ length: months }, (_, index) => ({
    month: new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' }).format(
      new Date(2026, 7 + index, 1),
    ),
    balance: (startingBalance + monthlyNet * (index + 1)) / 100,
    net: monthlyNet / 100,
  }))
}

export function categoryBreakdown(transactions: Transaction[]) {
  const categoryMap = new Map<string, number>()
  transactions
    .filter((transaction) => transaction.type === 'expense')
    .forEach((transaction) => {
      categoryMap.set(
        transaction.category,
        (categoryMap.get(transaction.category) ?? 0) + transaction.amountCents,
      )
    })

  return Array.from(categoryMap.entries())
    .map(([name, value]) => ({ name, value: value / 100 }))
    .sort((a, b) => b.value - a.value)
}

export function recurringPayments(transactions: Transaction[]) {
  return transactions
    .filter((transaction) => transaction.recurring && transaction.type === 'expense')
    .sort((a, b) => b.amountCents - a.amountCents)
}
