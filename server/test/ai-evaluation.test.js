import assert from 'node:assert/strict'
import test from 'node:test'
import { detectAiDrift, evaluateAiCases } from '../src/ai-evaluation.js'

const signal = (type, severity) => ({ type, severity })

test('passes a representative governed-finance evaluation set', () => {
  const report = evaluateAiCases([
    {
      expectedSignals: [signal('cashflow', 'warning')],
      actualSignals: [signal('cashflow', 'warning')],
      confidence: 0.82,
      correctness: 1,
      latencyMs: 850,
    },
    {
      expectedSignals: [signal('recurring-cost', 'warning')],
      actualSignals: [signal('recurring-cost', 'warning')],
      confidence: 0.9,
      correctness: 1,
      latencyMs: 1100,
    },
    {
      expectedSignals: [],
      actualSignals: [],
      mustAbstain: true,
      abstained: true,
      confidence: 0,
      correctness: 0,
      latencyMs: 300,
    },
    {
      expectedSignals: [signal('goal-risk', 'warning')],
      actualSignals: [signal('goal-risk', 'warning')],
      confidence: 0.88,
      correctness: 1,
      latencyMs: 920,
    },
  ])

  assert.equal(report.passed, true)
  assert.equal(report.metrics.precision, 1)
  assert.equal(report.metrics.recall, 1)
  assert.equal(report.metrics.abstentionSafety, 1)
  assert.ok(report.metrics.calibrationError <= 0.15)
})

test('fails closed when safety, quality, calibration, or latency regress', () => {
  const report = evaluateAiCases([
    {
      expectedSignals: [signal('cashflow', 'warning')],
      actualSignals: [signal('anomaly', 'critical')],
      confidence: 0.99,
      correctness: 0,
      latencyMs: 15_000,
    },
    {
      expectedSignals: [],
      actualSignals: [signal('goal-risk', 'warning')],
      mustAbstain: true,
      abstained: false,
      confidence: 0.95,
      correctness: 0,
      latencyMs: 14_000,
    },
  ])

  assert.equal(report.passed, false)
  assert.ok(report.failures.some((item) => item.startsWith('precision=')))
  assert.ok(report.failures.some((item) => item.startsWith('recall=')))
  assert.ok(report.failures.some((item) => item.startsWith('abstentionSafety=')))
  assert.ok(report.failures.some((item) => item.startsWith('calibrationError=')))
  assert.ok(report.failures.some((item) => item.startsWith('latencyP95Ms=')))
})

test('detects material model-quality drift against a reviewed baseline', () => {
  const baseline = { precision: 0.96, recall: 0.94, calibrationError: 0.08, latencyP95Ms: 1000 }
  const current = { precision: 0.88, recall: 0.87, calibrationError: 0.15, latencyP95Ms: 1700 }
  const result = detectAiDrift(current, baseline)

  assert.equal(result.drifted, true)
  assert.ok(result.alerts.some((item) => item.startsWith('precisionDrop=')))
  assert.ok(result.alerts.some((item) => item.startsWith('recallDrop=')))
  assert.ok(result.alerts.some((item) => item.startsWith('calibrationIncrease=')))
  assert.ok(result.alerts.some((item) => item.startsWith('latencyIncreaseRatio=')))
})

test('accepts stable evaluation metrics', () => {
  const baseline = { precision: 0.96, recall: 0.94, calibrationError: 0.08, latencyP95Ms: 1000 }
  const current = { precision: 0.94, recall: 0.92, calibrationError: 0.1, latencyP95Ms: 1200 }
  assert.equal(detectAiDrift(current, baseline).drifted, false)
})
