import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicScenarioInsights, governedAiModels, runGovernedEnsemble } from '../src/ai-ensemble.js'

const ANALYST_MODEL = 'Qwen/Qwen3-4B-Thinking-2507:fastest'
const ANALYST_REVISION = '768f209d9ea81521153ed38c47d515654e938aea'
const CRITIC_MODEL = 'Qwen/Qwen3-4B-Instruct-2507:fastest'
const CRITIC_REVISION = '1b4199c4f36b0cef378bfb12390c18780c18af4c'

test('requires exact reviewed model-and-revision pairs', () => {
  const models = governedAiModels(
    { HF_MODEL: ANALYST_MODEL, HF_MODEL_REVISION: ANALYST_REVISION },
    { model: ANALYST_MODEL, revision: ANALYST_REVISION },
  )
  assert.equal(models.analyst.model, ANALYST_MODEL)
  assert.equal(models.analyst.revision, ANALYST_REVISION)
  assert.throws(
    () => governedAiModels({ HF_MODEL: 'unknown/model', HF_MODEL_REVISION: ANALYST_REVISION }, { model: ANALYST_MODEL, revision: ANALYST_REVISION }),
    /allowlist/,
  )
  assert.throws(
    () => governedAiModels({ HF_MODEL: ANALYST_MODEL, HF_MODEL_REVISION: 'a'.repeat(40) }, { model: ANALYST_MODEL, revision: ANALYST_REVISION }),
    /revision|production lock/i,
  )
  const ensemble = governedAiModels(
    { HF_CRITIC_ENABLED: 'true', HF_CRITIC_MODEL: CRITIC_MODEL, HF_CRITIC_MODEL_REVISION: CRITIC_REVISION },
    { model: ANALYST_MODEL, revision: ANALYST_REVISION },
  )
  assert.equal(ensemble.critic.model, CRITIC_MODEL)
  assert.equal(ensemble.critic.revision, CRITIC_REVISION)
})

test('retains only signals independently agreed by analyst and critic', async () => {
  const completions = [
    JSON.stringify({ summary: 'analysis', confidence: 0.9, signals: [{ type: 'cashflow', severity: 'warning' }, { type: 'anomaly', severity: 'warning' }] }),
    JSON.stringify({ summary: 'critique', confidence: 0.8, signals: [{ type: 'cashflow', severity: 'warning' }] }),
  ]
  const result = await runGovernedEnsemble({
    transport: { chatCompletion: async () => completions.shift() },
    models: {
      analyst: { model: ANALYST_MODEL, revision: ANALYST_REVISION },
      critic: { model: CRITIC_MODEL, revision: CRITIC_REVISION },
    },
    snapshot: {},
    analystPrompt: () => [],
    parseAndValidate: JSON.parse,
  })
  assert.equal(result.result.signals.length, 1)
  assert.equal(result.result.signals[0].type, 'cashflow')
  assert.equal(result.result.confidence, 0.8)
  assert.equal(result.agreement, 0.5)
})

test('computes deterministic liquidity, health and stress intelligence', () => {
  const result = deterministicScenarioInsights({
    incomeCents: 200000,
    expenseCents: 180000,
    freeCashCents: 20000,
    recurringExpenseCents: 140000,
    accountBalanceCents: 120000,
    monthsCovered: 2,
    goals: [],
  })
  assert.equal(result.savingsRate, 0.1)
  assert.ok(result.recurringShare > 0.6)
  assert.ok(result.runwayMonths < 3)
  assert.ok(Number.isInteger(result.healthScore))
  assert.ok(result.healthScore >= 0 && result.healthScore <= 100)
  assert.equal(result.methodologyVersion, '2.0.0')
  assert.equal(result.stressScenarios.length, 3)
  assert.ok(result.insights.some((item) => item.code === 'high_recurring_share'))
  assert.ok(result.insights.some((item) => item.code === 'low_liquidity_runway'))
  assert.ok(result.insights.every((item, index, items) => index === 0 || items[index - 1].priority >= item.priority))
})

test('detects infeasible goals and prioritizes them', () => {
  const result = deterministicScenarioInsights({
    incomeCents: 300000,
    expenseCents: 290000,
    freeCashCents: 10000,
    recurringExpenseCents: 150000,
    accountBalanceCents: 400000,
    monthsCovered: 6,
    goals: [{ remainingCents: 1200000, targetDate: '2026-08-01' }],
  })
  assert.equal(result.goals.length, 1)
  assert.equal(result.goals[0].status, 'off-track')
  assert.ok(result.goals[0].requiredMonthlyCents >= 1200000)
  assert.ok(result.insights.some((item) => item.code === 'goal_feasibility_risk' && item.severity === 'critical'))
  assert.ok(result.healthScore < 60)
})

test('returns stable intelligence for zero-expense snapshots', () => {
  const result = deterministicScenarioInsights({
    incomeCents: 100000,
    expenseCents: 0,
    freeCashCents: 100000,
    recurringExpenseCents: 0,
    accountBalanceCents: 500000,
    monthsCovered: 3,
    goals: [],
  })
  assert.equal(result.recurringShare, 0)
  assert.equal(result.runwayMonths, null)
  assert.ok(result.healthScore >= 80)
  assert.ok(result.stressScenarios.every((scenario) => scenario.stressedRunwayMonths === null))
})
