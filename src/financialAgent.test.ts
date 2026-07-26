import { describe, expect, it } from 'vitest'
import { createFinancialAgentPlan, decideAgentAction } from './financialAgent'
import type { AppState } from './types'

const state: AppState = {
  accounts: [{ id: 'a', name: 'Giro', type: 'checking', balanceCents: 300000, currency: 'EUR' }],
  transactions: [
    { id: 'i', accountId: 'a', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 250000, date: '2026-07-01' },
    { id: 'e', accountId: 'a', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 90000, date: '2026-07-02', recurring: true },
  ],
  goals: [{ id: 'g', name: 'Notgroschen', targetCents: 500000, currentCents: 100000, targetDate: '2027-01-01' }],
}

describe('financial agent', () => {
  it('proposes bounded actions that always require approval', () => {
    const plan = createFinancialAgentPlan(state)
    expect(plan.actions.length).toBeGreaterThan(0)
    expect(plan.actions.every((action) => action.requiresApproval && action.status === 'proposed')).toBe(true)
    expect(plan.actions.find((action) => action.type === 'fund-goal')?.amountCents).toBeLessThanOrEqual(80000)
  })

  it('records approval without silently executing financial mutations', () => {
    const plan = createFinancialAgentPlan(state)
    const updated = decideAgentAction(plan, plan.actions[0].id, 'approved')
    expect(updated.actions[0].status).toBe('approved')
    expect(state.goals[0].currentCents).toBe(100000)
  })
})
