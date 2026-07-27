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

export function createSmartBriefing(state: AppState, now = new Date()): SmartBriefingItem[] {
  const end = now.getTime()
  const currentStart = end - 30 * DAY
  const previousStart = end - 60 * DAY
  const timestamp = (value: string) => new Date(`${value}T12:00:00`).getTime()
  const current = state.transactions.filter((item) => { const date = timestamp(item.date); return date >= currentStart && date <= end })
  const previous = state.transactions.filter((item) => { const date = timestamp(item.date); return date >= previousStart && date < currentStart })
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
      title: change > 0 ? 'Ausgaben steigen' : 'Ausgaben sinken',
      detail: `Deine Ausgaben liegen in den letzten 30 Tagen ${Math.abs(change)} % ${change > 0 ? 'über' : 'unter'} dem vorherigen Zeitraum.`,
      severity: change > 0 ? 'attention' : 'positive',
      priority: change > 0 ? 95 : 70,
    })
  }

  if (currentIncome > 0) {
    const savingsRate = Math.round(((currentIncome - currentExpenses) / currentIncome) * 100)
    items.push({
      id: 'savings-rate',
      title: `Sparquote ${savingsRate} %`,
      detail: savingsRate >= 20 ? 'Du hältst derzeit eine solide Sparquote.' : savingsRate >= 0 ? 'Schon kleine Ausgabenkürzungen würden deine Sparquote sichtbar erhöhen.' : 'Deine Ausgaben übersteigen aktuell die Einnahmen.',
      severity: savingsRate >= 20 ? 'positive' : savingsRate >= 0 ? 'neutral' : 'attention',
      priority: savingsRate < 0 ? 100 : 80,
    })
  }

  if (currentIncome > 0 && recurring > currentIncome * 0.35) items.push({
    id: 'recurring-load',
    title: 'Hohe Fixkostenquote',
    detail: `${Math.round((recurring / currentIncome) * 100)} % deiner letzten Einnahmen sind durch wiederkehrende Ausgaben gebunden.`,
    severity: 'attention',
    priority: 90,
  })

  const monthlyBurn = Math.max(currentExpenses, recurring)
  if (monthlyBurn > 0) {
    const runway = available / monthlyBurn
    items.push({
      id: 'cash-runway',
      title: `${runway.toFixed(1).replace('.', ',')} Monate Reichweite`,
      detail: runway >= 3 ? 'Deine verfügbaren Guthaben decken mindestens drei aktuelle Ausgabenmonate.' : 'Ein größerer Liquiditätspuffer würde unerwartete Kosten besser abfangen.',
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
    title: `${urgentGoal.goal.name}: noch ${urgentGoal.days} Tage`,
    detail: `Es fehlen ${((urgentGoal.goal.targetCents - urgentGoal.goal.currentCents) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}.`,
    severity: 'neutral',
    priority: 75,
  })

  return items.sort((a, b) => b.priority - a.priority).slice(0, 4)
}
