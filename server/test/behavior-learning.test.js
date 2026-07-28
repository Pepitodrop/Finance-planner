import assert from 'node:assert/strict'
import test from 'node:test'
import { learnBehaviorPatterns, validateBehaviorHistory } from '../src/behavior-learning.js'
import { publicModelCatalog } from '../src/ai-model-catalog.js'

test('catalog exposes lightweight optional capabilities without bundling weights', () => {
  const models = publicModelCatalog()
  assert.equal(models.length, 5)
  assert.ok(models.some((model) => model.capability === 'semantic-search'))
  assert.ok(models.some((model) => model.capability === 'relationship-prediction'))
  assert.equal(models.filter((model) => model.enabledByDefault).length, 1)
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
  assert.ok(result.predictions.nextMonthExpenseCents >= 0)
})

test('rejects user-controlled text and excessive histories', () => {
  assert.throws(() => validateBehaviorHistory([{ date: '2026-07-01', amountCents: 10, type: 'expense', categoryRank: 1, recurring: false, merchant: 'private' }]), /Unexpected/)
  assert.throws(() => validateBehaviorHistory(Array.from({ length: 5001 }, () => ({}))), /at most 5000/)
})
