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

test('requires authentication before AI inference', async () => {
  const router = createAiRouter({
    env: {},
    send: () => {},
    body: async () => ({ consentExternalAi: true, snapshot }),
    userId: () => { throw new Error('Authentication required.') },
  })
  await assert.rejects(() => router({ method: 'POST' }, {}, new URL('http://localhost/api/ai/financial-intelligence')), /Authentication required/)
})

test('requires explicit external-AI consent', async () => {
  const router = createAiRouter({
    env: {},
    send: () => {},
    body: async () => ({ consentExternalAi: false, snapshot }),
    userId: () => 'user-1',
  })
  await assert.rejects(
    () => router({ method: 'POST' }, {}, new URL('http://localhost/api/ai/financial-intelligence')),
    (error) => error.code === 'ai_consent_required',
  )
})

test('rejects user-controlled text in the external snapshot schema', async () => {
  const router = createAiRouter({
    env: { HF_TOKEN: 'token' },
    send: () => {},
    body: async () => ({
      consentExternalAi: true,
      snapshot: { ...snapshot, goals: [{ name: 'Private goal', remainingCents: 1, targetDate: '2027-06-01' }] },
    }),
    userId: () => 'user-1',
  })
  await assert.rejects(
    () => router({ method: 'POST' }, responseRecorder(), new URL('http://localhost/api/ai/financial-intelligence')),
    (error) => error.code === 'invalid_ai_snapshot',
  )
})
