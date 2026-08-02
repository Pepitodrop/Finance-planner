import assert from 'node:assert/strict'
import test from 'node:test'
import { learnBehaviorPatterns, validateBehaviorHistory } from '../src/behavior-learning.js'
import { publicModelCatalog } from '../src/ai-model-catalog.js'

test('catalog distinguishes integrated and worker-ready capabilities', () => {
  const models = publicModelCatalog()
  assert.equal(models.length, 7)
  assert.equal(models.filter((model) => model.integrationStatus === 'integrated').length, 2)
  assert.equal(models.filter((model) => model.integrationStatus === 'integrated-optional').length, 1)
  assert.equal(models.filter((model) => model.integrationStatus === 'worker-ready').length, 4)
  assert.equal(models.filter((model) => model.enabledByDefault).length, 2)
  assert.ok(models.some((model) => model.capability === 'sustainable-receipt-review'
    && model.integrationStatus === 'integrated'
    && model.license === 'Apache-2.0'))
  assert.ok(models.every((model) => typeof model.license === 'string' && model.license.length > 0))
})

test('learns bounded behavior patterns without descriptions or identifiers', () => {
  const events = [
    { date: '2026-06-01', amountCents: 250000, type: 'income', categoryRank: 0, recurring: true },
    { date: '2026-06-02', amountCents: 90000, type: 'expense', categoryRank: 1, recurring: true },
    { date: '2026-06-09', amountCents: 25000, type: 'expense', categoryRank: 2, recurring: false },
    { date: '2026-07-01', amountCents: 250000, type: 'income', categoryRank: 0, recurring: true },
    { date: '2026-07-02', amountCents: 90000, type: 'expense', categoryRank: 1, recurring: true },
  ]
  const result = learnBehaviorPatterns(events, new Date('2026-07-28T00:00:00Z'))
  assert.equal(result.sampleSize, 5)
  assert.equal(result.patterns.strongestCategoryRank, 1)
  assert.equal(result.privacy.persistedByModule, false)
  assert.equal(result.privacy.rawDescriptionsUsed, false)
  assert.equal(result.privacy.trustedServerHistoryRequired, true)
  assert.ok(result.predictions.nextMonthExpenseCents >= 0)
})

test('rejects text, excessive histories, and future-dated events', () => {
  const now = new Date('2026-07-28T00:00:00Z')
  assert.throws(() => validateBehaviorHistory([{ date: '2026-07-01', amountCents: 10, type: 'expense', categoryRank: 1, recurring: false, merchant: 'private' }], now), /Unexpected/)
  assert.throws(() => validateBehaviorHistory(Array.from({ length: 5001 }, () => ({})), now), /at most 5000/)
  assert.throws(() => validateBehaviorHistory([{ date: '2026-07-29', amountCents: 10, type: 'expense', categoryRank: 1, recurring: false }], now), /future/)
})
