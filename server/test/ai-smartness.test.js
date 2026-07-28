import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicScenarioInsights, runGovernedEnsemble } from '../src/ai-ensemble.js'

const analystModel = { model: 'analyst', revision: 'a'.repeat(40) }
const criticModel = { model: 'critic', revision: 'b'.repeat(40) }
const snapshot = {
  incomeCents: 300000,
  expenseCents: 280000,
  freeCashCents: 20000,
  recurringExpenseCents: 190000,
  accountBalanceCents: 200000,
  transactionCount: 80,
  monthsCovered: 6,
  categoryTotals: [],
  goals: [{ remainingCents: 1200000, targetDate: '2027-08-01' }],
}

function parse(content) {
  return JSON.parse(content)
}

test('abstains when analyst and critic do not reach sufficient consensus', async () => {
  const completions = [
    JSON.stringify({ summary: 'Analyst', confidence: 0.9, signals: [
      { type: 'cashflow', severity: 'warning', title: 'A', explanation: 'A', confidence: 0.9, evidence: [] },
      { type: 'goal-risk', severity: 'critical', title: 'B', explanation: 'B', confidence: 0.9, evidence: [] },
    ] }),
    JSON.stringify({ summary: 'Critic', confidence: 0.8, signals: [
      { type: 'cashflow', severity: 'warning', title: 'A', explanation: 'A', confidence: 0.8, evidence: [] },
      { type: 'recurring-cost', severity: 'warning', title: 'C', explanation: 'C', confidence: 0.8, evidence: [] },
    ] }),
  ]
  const transport = { chatCompletion: async () => completions.shift() }
  const result = await runGovernedEnsemble({
    transport,
    models: { analyst: analystModel, critic: criticModel },
    snapshot,
    analystPrompt: () => [],
    parseAndValidate: parse,
  })
  assert.equal(result.abstained, true)
  assert.equal(result.abstentionReason, 'insufficient_model_agreement')
  assert.equal(result.agreement, 0.33)
  assert.deepEqual(result.result.signals, [])
  assert.ok(result.result.confidence <= 0.4)
})

test('accepts only signals supported by both governed models', async () => {
  const agreed = { type: 'cashflow', severity: 'warning', title: 'A', explanation: 'A', confidence: 0.8, evidence: [] }
  const completions = [
    JSON.stringify({ summary: 'Analyst', confidence: 0.9, signals: [agreed] }),
    JSON.stringify({ summary: 'Critic', confidence: 0.8, signals: [agreed] }),
  ]
  const result = await runGovernedEnsemble({
    transport: { chatCompletion: async () => completions.shift() },
    models: { analyst: analystModel, critic: criticModel },
    snapshot,
    analystPrompt: () => [],
    parseAndValidate: parse,
  })
  assert.equal(result.abstained, false)
  assert.equal(result.agreement, 1)
  assert.equal(result.result.signals.length, 1)
})

test('provides stress testing and goal feasibility without model inference', () => {
  const scenarios = deterministicScenarioInsights(snapshot)
  assert.equal(scenarios.stressTest.expenseIncreasePercent, 15)
  assert.equal(typeof scenarios.stressTest.stressedFreeCashCents, 'number')
  assert.equal(scenarios.goalFeasibility.length, 1)
  assert.equal(typeof scenarios.goalFeasibility[0].requiredMonthlyCents, 'number')
  assert.equal(typeof scenarios.goalFeasibility[0].coverageRatio, 'number')
  assert.ok(scenarios.insights.some((insight) => insight.code === 'high_recurring_share'))
  assert.ok(scenarios.insights.some((insight) => insight.code === 'goal_funding_gap'))
})
