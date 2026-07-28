import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiRouter } from '../src/ai-router.js'

function responseRecorder() {
  return {
    status: 0,
    payload: undefined,
    writeHead(status) { this.status = status },
    end(value) { this.payload = JSON.parse(value) },
  }
}

function send(response, status, payload) {
  response.writeHead(status)
  response.end(JSON.stringify(payload))
}

const snapshot = {
  incomeCents: 250000,
  expenseCents: 123000,
  freeCashCents: 127000,
  recurringExpenseCents: 95000,
  accountBalanceCents: 180000,
  transactionCount: 3,
  monthsCovered: 1,
  categoryTotals: [{ rank: 1, amountCents: 95000 }],
  goals: [{ remainingCents: 400000, targetDate: '2027-06-01' }],
}

function routerWithCompletion(completion, inputSnapshot = snapshot) {
  return createAiRouter({
    env: { HF_TOKEN: 'token' },
    send,
    body: async () => ({ consentExternalAi: true, snapshot: inputSnapshot }),
    userId: () => 'user-1',
    transportFactory: () => ({ chatCompletion: async () => completion }),
  })
}

test('requires authentication before AI inference', async () => {
  const router = createAiRouter({ env: {}, send: () => {}, body: async () => ({ consentExternalAi: true, snapshot }), userId: () => { throw new Error('Authentication required.') } })
  await assert.rejects(() => router({ method: 'POST' }, {}, new URL('http://localhost/api/ai/financial-intelligence')), /Authentication required/)
})

test('requires explicit external-AI consent', async () => {
  const router = createAiRouter({ env: {}, send: () => {}, body: async () => ({ consentExternalAi: false, snapshot }), userId: () => 'user-1' })
  await assert.rejects(() => router({ method: 'POST' }, {}, new URL('http://localhost/api/ai/financial-intelligence')), (error) => error.code === 'ai_consent_required')
})

test('rejects user-controlled text in the external snapshot schema', async () => {
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' }, send: () => {},
    body: async () => ({ consentExternalAi: true, snapshot: { ...snapshot, goals: [{ name: 'Private goal', remainingCents: 1, targetDate: '2027-06-01' }] } }),
    userId: () => 'user-1',
  })
  await assert.rejects(() => router({ method: 'POST' }, responseRecorder(), new URL('http://localhost/api/ai/financial-intelligence')), (error) => error.code === 'invalid_ai_snapshot')
})

test('returns only validated, approval-gated and calibrated model signals', async () => {
  const router = routerWithCompletion(JSON.stringify({
    summary: 'Auswertung abgeschlossen.', confidence: 2,
    signals: [{ type: 'cashflow', severity: 'warning', title: 'Cashflow prüfen', explanation: 'Die Ausgaben sollten kontrolliert werden.', confidence: 1, evidence: ['Aggregierte Ausgaben'], suggestedAction: 'Budget prüfen', requiresApproval: false }],
  }))
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))
  assert.equal(response.status, 200)
  assert.equal(response.payload.source, 'hugging-face-reconciled')
  assert.equal(response.payload.confidence, 0.6)
  assert.equal(response.payload.confidenceDetails.modelConfidence, 1)
  assert.equal(response.payload.confidenceDetails.dataQuality.level, 'low')
  assert.equal(response.payload.signals[0].confidence, 0.6)
  assert.equal(response.payload.signals[0].requiresApproval, true)
  assert.ok(response.payload.signals[0].evidence.includes('freeCashCents=127000'))
})

test('removes signals that contradict verified snapshot facts', async () => {
  const noRecurringOrGoals = { ...snapshot, recurringExpenseCents: 0, goals: [] }
  const router = routerWithCompletion(JSON.stringify({
    summary: 'Risiken erkannt.', confidence: 0.9,
    signals: [
      { type: 'recurring-cost', severity: 'critical', title: 'Abo-Risiko', explanation: 'Viele Abos.', confidence: 0.9, evidence: [] },
      { type: 'goal-risk', severity: 'warning', title: 'Ziel gefährdet', explanation: 'Ein Ziel ist gefährdet.', confidence: 0.8, evidence: [] },
    ],
  }), noRecurringOrGoals)
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))
  assert.deepEqual(response.payload.signals, [])
  assert.equal(response.payload.warnings.length, 3)
  assert.match(response.payload.warnings.join(' '), /no recurring expenses/i)
  assert.match(response.payload.warnings.join(' '), /no goals/i)
})

test('caps aggregate-only anomaly claims and downgrades critical severity', async () => {
  const router = routerWithCompletion(JSON.stringify({
    summary: 'Anomalie erkannt.', confidence: 0.9,
    signals: [{ type: 'anomaly', severity: 'critical', title: 'Ungewöhnliche Zahlung', explanation: 'Eine Zahlung wirkt ungewöhnlich.', confidence: 0.99, evidence: ['Modellmuster'] }],
  }))
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))
  assert.equal(response.payload.signals[0].severity, 'warning')
  assert.equal(response.payload.signals[0].confidence, 0.55)
  assert.ok(response.payload.signals[0].evidence.includes('anomalyRequiresTransactionLevelVerification=true'))
})

test('normalizes cashflow severity against verified free cash', async () => {
  const router = routerWithCompletion(JSON.stringify({
    summary: 'Cashflow kritisch.', confidence: 0.8,
    signals: [{ type: 'cashflow', severity: 'critical', title: 'Cashflow kritisch', explanation: 'Der Cashflow sei kritisch.', confidence: 0.8, evidence: [] }],
  }))
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))
  assert.equal(response.payload.signals[0].severity, 'warning')
  assert.match(response.payload.warnings.join(' '), /positive/i)
})

test('falls back deterministically for malformed or unsupported model output', async () => {
  const router = routerWithCompletion(JSON.stringify({ summary: 'Unsafe', confidence: 1, signals: [{ type: 'transfer-money', severity: 'critical', title: 'Send', explanation: 'Send now', confidence: 1, evidence: [] }] }))
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))
  assert.equal(response.status, 200)
  assert.equal(response.payload.source, 'deterministic-fallback')
  assert.ok(response.payload.signals.length >= 1)
  assert.ok(response.payload.signals.every((signal) => signal.requiresApproval === true))
  assert.match(response.payload.warnings[0], /signal type/i)
  assert.equal(response.payload.confidenceDetails.modelConfidence, null)
})

test('falls back when the provider fails', async () => {
  const router = createAiRouter({ env: { HF_TOKEN: 'token' }, send, body: async () => ({ consentExternalAi: true, snapshot }), userId: () => 'user-1', transportFactory: () => ({ chatCompletion: async () => { throw new Error('provider unavailable') } }) })
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))
  assert.equal(response.payload.source, 'deterministic-fallback')
  assert.match(response.payload.warnings[0], /provider unavailable/)
})

test('rejects client-supplied behavior history', async () => {
  const router = createAiRouter({
    env: {}, send,
    body: async () => ({ consentBehaviorLearning: true, events: [] }),
    userId: () => 'user-1',
    loadBehaviorEvents: async () => [],
  })
  await assert.rejects(() => router({ method: 'POST' }, responseRecorder(), new URL('http://localhost/api/ai/behavior-prediction')), (error) => error.code === 'invalid_behavior_request')
})

test('loads behavior history from a trusted server-side source', async () => {
  let requestedUser
  const router = createAiRouter({
    env: {}, send,
    body: async () => ({ consentBehaviorLearning: true }),
    userId: () => 'user-1',
    loadBehaviorEvents: async (user) => {
      requestedUser = user
      return [{ date: '2026-07-01', amountCents: 10000, type: 'expense', categoryRank: 1, recurring: false }]
    },
  })
  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/behavior-prediction'))
  assert.equal(requestedUser, 'user-1')
  assert.equal(response.status, 200)
  assert.equal(response.payload.sampleSize, 1)
})
