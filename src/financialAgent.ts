import type { AppState } from './types'

export type AgentActionType = 'review-recurring' | 'fund-goal' | 'build-buffer' | 'review-anomaly'

export interface AgentAction {
  id: string
  type: AgentActionType
  title: string
  rationale: string
  amountCents?: number
  priority: 1 | 2 | 3
  requiresApproval: true
  status: 'proposed' | 'approved' | 'rejected'
}

export interface AgentPlan {
  generatedAt: string
  actions: AgentAction[]
  dataQuality: 'low' | 'medium' | 'high'
}

function stableId(type: AgentActionType, suffix: string): string {
  return `${type}:${suffix.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu, '-')}`
}

export function createFinancialAgentPlan(state: AppState): AgentPlan {
  const income = state.transactions.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amountCents, 0)
  const expenses = state.transactions.filter((item) => item.type === 'expense')
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amountCents, 0)
  const recurringTotal = expenses.filter((item) => item.recurring).reduce((sum, item) => sum + item.amountCents, 0)
  const freeCash = income - expenseTotal
  const actions: AgentAction[] = []

  if (recurringTotal > 0) actions.push({
    id: stableId('review-recurring', String(recurringTotal)),
    type: 'review-recurring',
    title: 'Wiederkehrende Ausgaben prüfen',
    rationale: `Bestätigte feste Zahlungen summieren sich auf ${(recurringTotal / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}.`,
    amountCents: recurringTotal,
    priority: 2,
    requiresApproval: true,
    status: 'proposed',
  })

  const goal = [...state.goals].sort((a, b) => a.targetDate.localeCompare(b.targetDate))[0]
  if (goal && freeCash > 0) {
    const remaining = Math.max(0, goal.targetCents - goal.currentCents)
    const allocation = Math.min(remaining, Math.round(freeCash * 0.5))
    if (allocation > 0) actions.push({
      id: stableId('fund-goal', goal.id),
      type: 'fund-goal',
      title: `Sparziel „${goal.name}“ finanzieren`,
      rationale: 'Verwendet höchstens 50 % des erfassten freien Cashflows und verändert keine Konten ohne Bestätigung.',
      amountCents: allocation,
      priority: 1,
      requiresApproval: true,
      status: 'proposed',
    })
  }

  if (freeCash <= 0) actions.push({
    id: stableId('build-buffer', 'negative-cashflow'),
    type: 'build-buffer',
    title: 'Liquiditätspuffer priorisieren',
    rationale: 'Der erfasste Cashflow ist nicht positiv. Der Agent schlägt deshalb keine automatische Zielzuweisung vor.',
    priority: 1,
    requiresApproval: true,
    status: 'proposed',
  })

  return {
    generatedAt: new Date().toISOString(),
    actions: actions.sort((a, b) => a.priority - b.priority),
    dataQuality: state.transactions.length >= 50 ? 'high' : state.transactions.length >= 15 ? 'medium' : 'low',
  }
}

export function decideAgentAction(plan: AgentPlan, actionId: string, decision: 'approved' | 'rejected'): AgentPlan {
  return { ...plan, actions: plan.actions.map((action) => action.id === actionId ? { ...action, status: decision } : action) }
}
