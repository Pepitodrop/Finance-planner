import assert from 'node:assert/strict'
import { deterministicScenarioInsights } from '../server/src/ai-ensemble.js'

const healthy = deterministicScenarioInsights({
  incomeCents: 3600000,
  expenseCents: 2400000,
  freeCashCents: 1200000,
  recurringExpenseCents: 900000,
  accountBalanceCents: 1800000,
  transactionCount: 120,
  monthsCovered: 6,
  categoryTotals: [],
  goals: [{ remainingCents: 300000, targetDate: '2030-12-31' }],
})

assert.equal(healthy.schemaVersion, 2)
assert.ok(healthy.financialHealthScore >= 80)
assert.equal(healthy.riskLevel, 'low')
assert.equal(healthy.dataConfidence, 1)
assert.ok(healthy.decisionConfidence <= 0.95)
assert.equal(healthy.goals[0].status, 'on-track')
assert.ok(healthy.prioritizedActions.every((action) => action.requiresApproval === true))

const stressed = deterministicScenarioInsights({
  incomeCents: 600000,
  expenseCents: 720000,
  freeCashCents: -120000,
  recurringExpenseCents: 600000,
  accountBalanceCents: 50000,
  transactionCount: 8,
  monthsCovered: 2,
  categoryTotals: [],
  goals: [{ remainingCents: 1000000, targetDate: '2027-01-01' }],
})

assert.equal(stressed.riskLevel, 'high')
assert.ok(stressed.financialHealthScore < healthy.financialHealthScore)
assert.ok(stressed.insights.some((item) => item.code === 'low_savings_rate' && item.severity === 'critical'))
assert.ok(stressed.insights.some((item) => item.code === 'low_liquidity_runway'))
assert.ok(stressed.insights.some((item) => item.code === 'goal_capacity_gap'))
assert.equal(stressed.prioritizedActions[0].code, 'stabilize_cashflow')
assert.ok(stressed.goals[0].status === 'at-risk' || stressed.goals[0].status === 'overdue')

for (const result of [healthy, stressed]) {
  assert.ok(Number.isInteger(result.financialHealthScore))
  assert.ok(result.financialHealthScore >= 0 && result.financialHealthScore <= 100)
  assert.ok(result.decisionConfidence >= 0 && result.decisionConfidence <= 1)
  assert.ok(result.dataConfidence >= 0 && result.dataConfidence <= 1)
  assert.ok(result.prioritizedActions.length <= 5)
  assert.ok(result.insights.every((item) => item.confidence >= 0 && item.confidence <= 1))
}

console.log('Decision intelligence verified: explainable scoring, goal feasibility, risk prioritisation, confidence bounds and approval requirements.')
