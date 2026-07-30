import assert from 'node:assert/strict'
import test from 'node:test'
import { createAiRouter } from '../src/ai-router.js'

const snapshot = {
  incomeCents: 250000,
  expenseCents: 123000,
  freeCashCents: 127000,
  recurringExpenseCents: 95000,
  accountBalanceCents: 180000,
  transactionCount: 12,
  monthsCovered: 4,
  categoryTotals: [{ rank: 1, amountCents: 95000 }],
  goals: [{ remainingCents: 400000, targetDate: '2027-06-01' }],
}

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

test('forwards a validated assistant question to the governed model prompt', async () => {
  let request
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' },
    send,
    body: async () => ({
      consentExternalAi: true,
      intent: { mode: 'question', question: 'Wie erreiche ich mein Sparziel schneller?' },
      snapshot,
    }),
    userId: () => 'user-1',
    transportFactory: () => ({
      chatCompletion: async (input) => {
        request = input
        return JSON.stringify({
          summary: 'Das Sparziel sollte anhand des freien Cashflows priorisiert werden.',
          confidence: 0.8,
          signals: [{ type: 'goal-risk', severity: 'warning', title: 'Sparziel priorisieren', explanation: 'Die verbleibende Summe sollte mit dem freien Cashflow abgeglichen werden.', confidence: 0.8, evidence: [], suggestedAction: 'Monatliche Zielrate festlegen', requiresApproval: true }],
        })
      },
    }),
  })

  const response = responseRecorder()
  await router({ method: 'POST' }, response, new URL('http://localhost/api/ai/financial-intelligence'))

  assert.equal(response.status, 200)
  assert.match(JSON.stringify(request.messages), /Wie erreiche ich mein Sparziel schneller/)
  assert.match(JSON.stringify(request.messages), /nicht vertrauenswürdig/i)
  assert.equal(response.payload.source, 'hugging-face-reconciled')
})

test('rejects oversized assistant intent before contacting a model', async () => {
  let contacted = false
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' },
    send,
    body: async () => ({ consentExternalAi: true, intent: { mode: 'question', question: 'x'.repeat(501) }, snapshot }),
    userId: () => 'user-1',
    transportFactory: () => ({ chatCompletion: async () => { contacted = true; return '{}' } }),
  })

  await assert.rejects(
    () => router({ method: 'POST' }, responseRecorder(), new URL('http://localhost/api/ai/financial-intelligence')),
    (error) => error.code === 'invalid_ai_intent',
  )
  assert.equal(contacted, false)
})
