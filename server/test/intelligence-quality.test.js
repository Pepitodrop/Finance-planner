import test from 'node:test'
import assert from 'node:assert/strict'
import { calibrateIntelligenceQuality, evaluateForecastOutcome, intelligenceFreshness, robustWeeklyTrend } from '../src/intelligence-quality.js'

test('robust trend resists one extreme weekly outlier', () => {
  const result = robustWeeklyTrend([10_000, 10_500, 11_000, 80_000, 11_500, 12_000])
  assert.equal(result.direction, 'increasing')
  assert.ok(result.slopeCentsPerWeek > 0)
  assert.ok(result.slopeCentsPerWeek < 10_000)
})

test('stale histories reduce confidence and eventually abstain', () => {
  const now = new Date('2026-08-03T00:00:00Z')
  assert.equal(intelligenceFreshness('2026-08-01T00:00:00Z', now).level, 'fresh')
  assert.equal(intelligenceFreshness('2026-05-01T00:00:00Z', now).abstain, true)
  const result = calibrateIntelligenceQuality({
    baseConfidence: 0.9,
    coverage: 0.9,
    sampleScore: 0.9,
    stabilityScore: 0.9,
    recurringCoverage: 0.9,
    providerCompleteness: 0.9,
    latestEventAt: '2026-05-01T00:00:00Z',
    now,
  })
  assert.equal(result.abstain, true)
  assert.equal(result.calibratedConfidence, 0)
})

test('provider incompleteness caps otherwise strong intelligence', () => {
  const result = calibrateIntelligenceQuality({
    baseConfidence: 0.95,
    coverage: 1,
    sampleScore: 1,
    stabilityScore: 0.9,
    recurringCoverage: 0.8,
    providerCompleteness: 0.2,
    latestEventAt: '2026-08-02T00:00:00Z',
    now: new Date('2026-08-03T00:00:00Z'),
  })
  assert.ok(result.calibratedConfidence < 0.8)
  assert.ok(result.reasons.includes('incomplete_provider_data'))
})

test('forecast outcome records coverage and requests wider ranges', () => {
  assert.deepEqual(evaluateForecastOutcome({ predictedLow: 90_000, predictedHigh: 110_000, actual: 100_000 }), {
    covered: true,
    relativeError: 0,
    calibrationError: 0,
    requiresWiderRange: false,
  })
  const missed = evaluateForecastOutcome({ predictedLow: 90_000, predictedHigh: 110_000, actual: 150_000 })
  assert.equal(missed.covered, false)
  assert.equal(missed.requiresWiderRange, true)
})
