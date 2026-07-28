import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFinancialReasoning } from '../src/financial-reasoning.js'

const snapshot = {
  incomeCents: 720000,
  expenseCents: 540000,
  freeCashCents: 180000,
  recurringExpenseCents: 360000,
  accountBalanceCents: 180000,
  transactionCount: 90,
  monthsCovered: 6,
  categoryTotals: [],
  goals: [{ remainingCents: 240000, targetDate: '2027-01-01' }],
}

test('normalizes aggregates, forecasts goals and runs deterministic stress tests', () => {
  const result = buildFinancialReasoning(snapshot, { now: new Date('2026-07-01T00:00:00Z') })
  assert.deepEqual(result.monthly, {
    incomeCents: 120000,
    expenseCents: 90000,
    freeCashCents: 30000,
    recurringExpenseCents: 60000,
  })
  assert.equal(result.savingsRate, 0.25)
  assert.equal(result.recurringShare, 0.667)
  assert.equal(result.runwayMonths, 2)
  assert.equal(result.goals[0].monthsRemaining, 6)
  assert.equal(result.goals[0].requiredMonthlyCents, 40000)
  assert.equal(result.goals[0].monthlyGapCents, -10000)
  assert.equal(result.goals[0].feasibility, 'at-risk')
  assert.equal(result.stressScenarios.length, 3)
  assert.ok(result.insights.some((item) => item.code === 'goal_funding_gap'))
  assert.ok(result.insights.some((item) => item.code === 'stress_test_failure'))
  assert.equal(result.dataReliability, 0.78)
})

test('handles no expenses and completed goals without divisions by zero', () => {
  const result = buildFinancialReasoning({ ...snapshot, expenseCents: 0, recurringExpenseCents: 0, freeCashCents: 720000, accountBalanceCents: 0, goals: [{ remainingCents: 0, targetDate: '2026-08-01' }] }, { now: new Date('2026-07-01T00:00:00Z') })
  assert.equal(result.runwayMonths, null)
  assert.equal(result.goals[0].feasibility, 'on-track')
  assert.ok(result.stressScenarios.every((item) => item.remainsPositive))
})
