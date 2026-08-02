import assert from 'node:assert/strict'
import test from 'node:test'
import { OperationalMetrics, operationalRoute } from '../src/operational-metrics.js'

test('normalizes routes without exposing identifiers or query strings', () => {
  assert.equal(operationalRoute('/api/connectors/gocardless/start?state=secret'), '/api/connectors/:provider/start')
  assert.equal(operationalRoute('/api/connectors/webhooks/paypal'), '/api/connectors/webhooks/:provider')
  assert.equal(operationalRoute('/api/finance/state'), '/api/finance/state')
  assert.equal(operationalRoute('/api/unknown/private-description'), '/api/unknown')
})

test('records bounded HTTP, bank, AI and deletion metrics', () => {
  let now = 1_000
  const metrics = new OperationalMetrics({ now: () => now, version: '0.2.0', commit: 'abc123' })
  metrics.recordHttp({ method: 'POST', pathname: '/api/ai/budget-plan?prompt=private', status: 200, durationMs: 42 })
  metrics.recordBank('gocardless', 'success')
  metrics.recordAi('/api/ai/budget-plan', 'hugging-face-budget-explanation')
  metrics.recordAccountDeletion('success')
  now += 5_000

  const snapshot = metrics.snapshot()
  assert.equal(snapshot.uptimeSeconds, 5)
  assert.equal(snapshot.counters.some((entry) => entry.name === 'finance_planner_http_requests_total' && entry.labels.route === '/api/ai/budget-plan'), true)
  assert.equal(JSON.stringify(snapshot).includes('prompt'), false)
  assert.equal(JSON.stringify(snapshot).includes('private'), false)

  const output = metrics.prometheus()
  assert.match(output, /finance_planner_build_info\{commit="abc123",version="0.2.0"\} 1/)
  assert.match(output, /finance_planner_http_request_duration_ms_bucket/)
  assert.match(output, /finance_planner_bank_operations_total\{outcome="success",provider="gocardless"\} 1/)
  assert.match(output, /finance_planner_ai_responses_total\{route="\/api\/ai\/budget-plan",source="hosted"\} 1/)
  assert.doesNotMatch(output, /private|prompt=/)
})

test('caps series growth instead of accepting attacker-controlled cardinality', () => {
  const metrics = new OperationalMetrics({ maxSeries: 3 })
  metrics.increment('finance_planner_test_total', { route: 'one' })
  metrics.increment('finance_planner_test_total', { route: 'two' })
  metrics.increment('finance_planner_test_total', { route: 'three' })
  metrics.increment('finance_planner_test_total', { route: 'four' })
  assert.equal(metrics.snapshot().counters.length, 3)
})
