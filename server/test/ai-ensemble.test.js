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

test('computes deterministic liquidity and spending scenarios', () => {
  const result = deterministicScenarioInsights({ incomeCents: 200000, expenseCents: 180000, freeCashCents: 20000, recurringExpenseCents: 140000, accountBalanceCents: 120000, monthsCovered: 2 })
  assert.equal(result.savingsRate, 0.1)
  assert.ok(result.recurringShare > 0.6)
  assert.ok(result.runwayMonths < 3)
  assert.ok(result.insights.some((item) => item.code === 'high_recurring_share'))
  assert.ok(result.insights.some((item) => item.code === 'low_liquidity_runway'))
})