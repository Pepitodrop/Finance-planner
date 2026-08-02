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

test('abstains when history is too sparse for a reliable prediction', () => {
  const events = [
    { date: '2026-06-01', amountCents: 250000, type: 'income', categoryRank: 0, recurring: true },
    { date: '2026-06-02', amountCents: 90000, type: 'expense', categoryRank: 1, recurring: true },
    { date: '2026-07-01', amountCents: 250000, type: 'income', categoryRank: 0, recurring: true },
    { date: '2026-07-02', amountCents: 90000, type: 'expense', categoryRank: 1, recurring: true },
  ]
  const result = learnBehaviorPatterns(events, new Date('2026-07-28T00:00:00Z'))
  assert.equal(result.abstained, true)
  assert.equal(result.abstentionReason, 'insufficient_recent_history')
  assert.equal(result.predictions, null)
  assert.ok(result.signals.some((signal) => signal.type === 'insufficient-data'))
})

test('learns calibrated patterns, ranges and amount-weighted recurring share', () => {
  const events = []
  for (let week = 0; week < 10; week += 1) {
    const day = 1 + week * 7
    events.push({ date: new Date(Date.UTC(2026, 4, day)).toISOString(), amountCents: 62000 + week * 1000, type: 'expense', categoryRank: 1, recurring: true })
    events.push({ date: new Date(Date.UTC(2026, 4, day + 2)).toISOString(), amountCents: 10000, type: 'expense', categoryRank: 2, recurring: false })
  }
  events.push({ date: '2026-05-01', amountCents: 300000, type: 'income', categoryRank: 0, recurring: true })
  events.push({ date: '2026-06-01', amountCents: 310000, type: 'income', categoryRank: 0, recurring: true })
  events.push({ date: '2026-07-01', amountCents: 320000, type: 'income', categoryRank: 0, recurring: true })

  const result = learnBehaviorPatterns(events, new Date('2026-07-28T00:00:00Z'))
  assert.equal(result.abstained, false)
  assert.equal(result.patterns.strongestCategoryRank, 1)
  assert.equal(result.patterns.activeWeeks >= 8, true)
  assert.equal(result.privacy.persistedByModule, false)
  assert.equal(result.privacy.rawDescriptionsUsed, false)
  assert.equal(result.privacy.trustedServerHistoryRequired, true)
  assert.ok(result.confidence > 0.4)
  assert.ok(result.predictions.nextMonthExpenseCents > 0)
  assert.ok(result.predictions.expenseRangeCents.low <= result.predictions.nextMonthExpenseCents)
  assert.ok(result.predictions.expenseRangeCents.high >= result.predictions.nextMonthExpenseCents)
  assert.ok(result.patterns.recurringExpenseShare > 0.8)
  assert.equal(result.quality.method, 'recency-weighted-robust-forecast-v2')
})

test('flags a robust spending anomaly without using descriptions', () => {
  const events = []
  for (let week = 0; week < 8; week += 1) {
    events.push({ date: new Date(Date.UTC(2026, 5, 1 + week * 7)).toISOString(), amountCents: week === 7 ? 300000 : 20000 + (week % 3) * 500, type: 'expense', categoryRank: 1, recurring: false })
  }
  events.push({ date: '2026-06-01', amountCents: 250000, type: 'income', categoryRank: 0, recurring: true })
  events.push({ date: '2026-07-01', amountCents: 250000, type: 'income', categoryRank: 0, recurring: true })
  const result = learnBehaviorPatterns(events, new Date('2026-07-28T00:00:00Z'))
  assert.equal(result.abstained, false)
  assert.ok(result.signals.some((signal) => signal.type === 'anomaly'))
})

test('rejects text, excessive histories, and future-dated events', () => {
  const now = new Date('2026-07-28T00:00:00Z')
  assert.throws(() => validateBehaviorHistory([{ date: '2026-07-01', amountCents: 10, type: 'expense', categoryRank: 1, recurring: false, merchant: 'private' }], now), /Unexpected/)
  assert.throws(() => validateBehaviorHistory(Array.from({ length: 5001 }, () => ({})), now), /at most 5000/)
  assert.throws(() => validateBehaviorHistory([{ date: '2026-07-29', amountCents: 10, type: 'expense', categoryRank: 1, recurring: false }], now), /future/)
})
