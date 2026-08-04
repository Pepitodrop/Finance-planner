import { detectRecurringPayments } from './recurringDetection'
import type { AppState, Transaction } from './types'

export const formatMoney = (cents: number) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export function totalBalance(state: AppState): number {
  return state.accounts.reduce((sum, account) => sum + account.balanceCents, 0)
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function currentMonthTotals(transactions: Transaction[], referenceDate = new Date()) {
  const currentMonth = monthKey(referenceDate)
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

function averageMonthlyCashFlow(transactions: Transaction[]): { incomeCents: number; expenseCents: number } {
  if (!transactions.length) return { incomeCents: 0, expenseCents: 0 }
  const grouped = new Map<string, { incomeCents: number; expenseCents: number }>()
  for (const transaction of transactions) {
    const key = transaction.date.slice(0, 7)
    const totals = grouped.get(key) ?? { incomeCents: 0, expenseCents: 0 }
    if (transaction.type === 'income') totals.incomeCents += transaction.amountCents
    else totals.expenseCents += transaction.amountCents
    grouped.set(key, totals)
  }
  const months = [...grouped.values()]
  return {
    incomeCents: Math.round(months.reduce((sum, item) => sum + item.incomeCents, 0) / months.length),
    expenseCents: Math.round(months.reduce((sum, item) => sum + item.expenseCents, 0) / months.length),
  }
}

export function monthlyProjection(state: AppState, months = 12, referenceDate = new Date()) {
  const average = averageMonthlyCashFlow(state.transactions)
  const monthlyNet = average.incomeCents - average.expenseCents
  const startingBalance = totalBalance(state)

  return Array.from({ length: Math.max(0, months) }, (_, index) => {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + index + 1, 1)
    return {
      month: new Intl.DateTimeFormat('de-DE', { month: 'short', year: '2-digit' }).format(date),
      balance: (startingBalance + monthlyNet * (index + 1)) / 100,
      net: monthlyNet / 100,
    }
  })
}

export function categoryBreakdown(transactions: Transaction[]) {
  const categoryMap = new Map<string, number>()
  transactions
    .filter((transaction) => transaction.type === 'expense')
    .forEach((transaction) => {
      categoryMap.set(transaction.category, (categoryMap.get(transaction.category) ?? 0) + transaction.amountCents)
    })

  return Array.from(categoryMap.entries())
    .map(([name, value]) => ({ name, value: value / 100 }))
    .sort((a, b) => b.value - a.value)
}

export interface RecurringSeries {
  id: string
  description: string
  category: string
  accountId: string
  type: Transaction['type']
  amountCents: number
  occurrenceCount: number
  firstDate: string
  lastDate: string
}

function recurringKey(transaction: Transaction): string {
  const normalizedDescription = transaction.description
    .toLocaleLowerCase('de-DE')
    .replace(/\b(?:gmbh|ag|se|kg|ug|mbh)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return [normalizedDescription, transaction.accountId, transaction.type, transaction.amountCents].join('|')
}

export function recurringPayments(transactions: Transaction[]): RecurringSeries[] {
  const detectedIds = new Set(detectRecurringPayments(transactions).map((candidate) => candidate.transaction.id))
  const candidates = transactions.filter((transaction) => transaction.recurring || detectedIds.has(transaction.id))
  const grouped = new Map<string, Transaction[]>()

  for (const transaction of candidates) {
    const key = recurringKey(transaction)
    const entries = grouped.get(key) ?? []
    entries.push(transaction)
    grouped.set(key, entries)
  }

  return [...grouped.entries()]
    .map(([id, entries]) => {
      const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date))
      const representative = sorted.at(-1)!
      return {
        id,
        description: representative.description,
        category: representative.category,
        accountId: representative.accountId,
        type: representative.type,
        amountCents: Math.round(sorted.reduce((sum, item) => sum + item.amountCents, 0) / sorted.length),
        occurrenceCount: sorted.length,
        firstDate: sorted[0].date,
        lastDate: representative.date,
      }
    })
    .filter((series) => series.occurrenceCount > 1)
    .sort((a, b) => b.amountCents - a.amountCents || a.description.localeCompare(b.description, 'de-DE'))
}
