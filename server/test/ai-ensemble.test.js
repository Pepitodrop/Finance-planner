import assert from 'node:assert/strict'
import test from 'node:test'
import { deterministicScenarioInsights, governedAiModels, runGovernedEnsemble } from '../src/ai-ensemble.js'

const revision = 'a'.repeat(40)

test('requires immutable revisions and reviewed open models', () => {
  const models = governedAiModels({ HF_MODEL: 'Qwen/Qwen3-4B-Instruct-2507:fastest', HF_MODEL_REVISION: revision }, { model: 'unused', revision })
  assert.equal(models.analyst.model, 'Qwen/Qwen3-4B-Instruct-2507:fastest')
  assert.throws(() => governedAiModels({ HF_MODEL: 'unknown/model', HF_MODEL_REVISION: revision }, { model: 'unused', revision }), /allowlist/)
})

test('retains only signals independently agreed by analyst and critic', async () => {
  const completions = [
    JSON.stringify({ summary: 'analysis', confidence: 0.9, signals: [{ type: 'cashflow', severity: 'warning' }, { type: 'anomaly', severity: 'warning' }] }),
    JSON.stringify({ summary: 'critique', confidence: 0.8, signals: [{ type: 'cashflow', severity: 'warning' }] }),
  ]
  const result = await runGovernedEnsemble({
    transport: { chatCompletion: async () => completions.shift() },
    models: { analyst: { model: 'a', revision }, critic: { model: 'b', revision } },
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
