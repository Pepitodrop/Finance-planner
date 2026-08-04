import { categoryBreakdown, currentMonthTotals, monthlyProjection, totalBalance } from '../../finance'
import type { Account, AppState, SavingsGoal, Transaction } from '../../types'

export interface DashboardCategory {
  name: string
  amountCents: number
  percentage: number
}

export interface DashboardProjectionPoint {
  month: string
  balance: number
  currentBalance?: number
  projectedBalance?: number
}

export interface DashboardViewModel {
  periodLabel: string
  totalBalanceCents: number
  incomeCents: number
  expenseCents: number
  surplusCents: number
  projection: DashboardProjectionPoint[]
  categories: DashboardCategory[]
  accounts: Account[]
  goals: Array<SavingsGoal & { progress: number }>
  recentTransactions: Transaction[]
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function buildDashboardViewModel(state: AppState, referenceDate = new Date()): DashboardViewModel {
  const totals = currentMonthTotals(state.transactions, referenceDate)
  const startingBalanceCents = totalBalance(state)
  const projected = monthlyProjection(state, 12, referenceDate)
  const currentMonthExpenses = state.transactions.filter((transaction) =>
    transaction.type === 'expense' && transaction.date.startsWith(monthKey(referenceDate)),
  )
  const categoryValues = categoryBreakdown(currentMonthExpenses)
  const categoryTotalCents = categoryValues.reduce((sum, category) => sum + Math.round(category.value * 100), 0)

  return {
    periodLabel: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(referenceDate),
    totalBalanceCents: startingBalanceCents,
    incomeCents: totals.incomeCents,
    expenseCents: totals.expenseCents,
    surplusCents: totals.incomeCents - totals.expenseCents,
    projection: [
      {
        month: 'Today',
        balance: startingBalanceCents / 100,
        currentBalance: startingBalanceCents / 100,
        projectedBalance: startingBalanceCents / 100,
      },
      ...projected.map((point, index) => ({
        month: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(
          new Date(referenceDate.getFullYear(), referenceDate.getMonth() + index + 1, 1),
        ),
        balance: point.balance,
        projectedBalance: point.balance,
      })),
    ],
    categories: categoryValues.map((category) => {
      const amountCents = Math.round(category.value * 100)
      return {
        name: category.name,
        amountCents,
        percentage: categoryTotalCents > 0 ? Math.round((amountCents / categoryTotalCents) * 100) : 0,
      }
    }),
    accounts: state.accounts.slice(0, 4),
    goals: state.goals.slice(0, 3).map((goal) => ({
      ...goal,
      progress: goal.targetCents > 0 ? Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)) : 0,
    })),
    recentTransactions: [...state.transactions].sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5),
  }
}

export function isDetectedTransfer(transaction: Transaction): boolean {
  return /transfer|umbuch|übertrag/i.test(`${transaction.category} ${transaction.description}`)
}
