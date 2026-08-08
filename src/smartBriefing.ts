import type { AppState, Transaction } from './types'

export type BriefingSeverity = 'positive' | 'attention' | 'neutral'

export interface SmartBriefingItem {
  id: string
  title: string
  detail: string
  severity: BriefingSeverity
  priority: number
}

const DAY = 86_400_000
const sum = (items: Transaction[], type: Transaction['type']) => items.filter((item) => item.type === type).reduce((total, item) => total + item.amountCents, 0)
const timestamp = (value: string) => new Date(`${value}T12:00:00`).getTime()

function monthToDateWindows(now: Date) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()
  const previousMonth = new Date(year, month - 1, 1)
  const previousMonthDays = new Date(year, month, 0).getDate()
  const previousEndDay = Math.min(day, previousMonthDays)

  return {
    currentStart: new Date(year, month, 1).getTime(),
    currentEnd: new Date(year, month, day, 23, 59, 59, 999).getTime(),
    previousStart: previousMonth.getTime(),
    previousEnd: new Date(previousMonth.getFullYear(), previousMonth.getMonth(), previousEndDay, 23, 59, 59, 999).getTime(),
  }
}

export function createSmartBriefing(state: AppState, now = new Date()): SmartBriefingItem[] {
  const end = now.getTime()
  const { currentStart, currentEnd, previousStart, previousEnd } = monthToDateWindows(now)
  const current = state.transactions.filter((item) => { const date = timestamp(item.date); return date >= currentStart && date <= currentEnd })
  const previous = state.transactions.filter((item) => { const date = timestamp(item.date); return date >= previousStart && date <= previousEnd })
  const currentExpenses = sum(current, 'expense')
  const previousExpenses = sum(previous, 'expense')
  const currentIncome = sum(current, 'income')
  const recurring = current.filter((item) => item.type === 'expense' && item.recurring).reduce((total, item) => total + item.amountCents, 0)
  const available = state.accounts.reduce((total, account) => total + account.balanceCents, 0)
  const items: SmartBriefingItem[] = []

  if (previousExpenses > 0) {
    const change = Math.round(((currentExpenses - previousExpenses) / previousExpenses) * 100)
    if (Math.abs(change) >= 10) items.push({
      id: 'spending-trend',
      title: change > 0 ? 'Spending rising' : 'Spending falling',
      detail: `Your expenses this month so far are ${Math.abs(change)}% ${change > 0 ? 'above' : 'below'} the same period last month.`,
      severity: change > 0 ? 'attention' : 'positive',
      priority: change > 0 ? 95 : 70,
    })
  }

  if (currentIncome > 0) {
    const savingsRate = Math.round(((currentIncome - currentExpenses) / currentIncome) * 100)
    items.push({
      id: 'savings-rate',
      title: `Savings rate ${savingsRate}%`,
      detail: savingsRate >= 20 ? 'You are currently holding a solid savings rate.' : savingsRate >= 0 ? 'Even small spending cuts would noticeably increase your savings rate.' : 'Your expenses currently exceed your income.',
      severity: savingsRate >= 20 ? 'positive' : savingsRate >= 0 ? 'neutral' : 'attention',
      priority: savingsRate < 0 ? 100 : 80,
    })
  }

  if (currentIncome > 0 && recurring > currentIncome * 0.35) items.push({
    id: 'recurring-load',
    title: 'High recurring-cost share',
    detail: `${Math.round((recurring / currentIncome) * 100)}% of your income this month is committed to recurring expenses.`,
    severity: 'attention',
    priority: 90,
  })

  const monthlyBurn = Math.max(currentExpenses, recurring)
  if (monthlyBurn > 0) {
    const runway = available / monthlyBurn
    items.push({
      id: 'cash-runway',
      title: `${runway.toFixed(1)} months runway`,
      detail: runway >= 3 ? 'Your available balance covers at least three months of current spending.' : 'A larger cash buffer would better absorb unexpected costs.',
      severity: runway >= 3 ? 'positive' : 'attention',
      priority: runway < 1 ? 98 : runway < 3 ? 85 : 55,
    })
  }

  const urgentGoal = state.goals
    .filter((goal) => goal.currentCents < goal.targetCents)
    .map((goal) => ({ goal, days: Math.ceil((new Date(`${goal.targetDate}T12:00:00`).getTime() - end) / DAY) }))
    .filter(({ days }) => days > 0 && days <= 90)
    .sort((a, b) => a.days - b.days)[0]
  if (urgentGoal) items.push({
    id: `goal-${urgentGoal.goal.id}`,
    title: `${urgentGoal.goal.name}: ${urgentGoal.days} days left`,
    detail: `${((urgentGoal.goal.targetCents - urgentGoal.goal.currentCents) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} still needed.`,
    severity: 'neutral',
    priority: 75,
  })

  return items.sort((a, b) => b.priority - a.priority).slice(0, 4)
}
