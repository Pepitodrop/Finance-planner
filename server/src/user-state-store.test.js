import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptCloudPayload, encryptCloudPayload, validateCloudPayload } from './user-state-store.js'

const secret = 'state-store-test-secret-that-is-long-enough-123456'
const payload = {
  state: {
    accounts: [{ id: 'account-1', name: 'Girokonto', type: 'checking', balanceCents: 123400, currency: 'EUR' }],
    transactions: [{ id: 'transaction-1', accountId: 'account-1', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 4299, date: '2026-07-31', recurring: false }],
    goals: [{ id: 'goal-1', name: 'Notgroschen', targetCents: 500000, currentCents: 125000, targetDate: '2027-01-01' }],
  },
  secureData: {
    'behavior-graph-v1': [{ merchant: 'rewe', category: 'Lebensmittel', weight: 0.8 }],
    'assistant-memory-v1': [{ question: 'Wie spare ich?', answer: 'Regelmäßig.', mode: 'question', createdAt: '2026-07-31T09:00:00.000Z' }],
  },
}

test('cloud payload is validated and encrypted without plaintext financial records', () => {
  const normalized = validateCloudPayload(payload)
  const encrypted = encryptCloudPayload(normalized, secret)
  assert.equal(encrypted.format, 'finance-planner-user-state')
  assert.equal(JSON.stringify(encrypted).includes('REWE'), false)
  assert.deepEqual(decryptCloudPayload(encrypted, secret), normalized)
})

test('cloud payload rejects unknown fields and broken account references', () => {
  assert.throws(() => validateCloudPayload({ ...payload, unexpected: true }), /Unexpected payload field/)
  assert.throws(() => validateCloudPayload({
    ...payload,
    state: { ...payload.state, transactions: [{ ...payload.state.transactions[0], accountId: 'missing' }] },
  }), /existing account/)
})

test('cloud payload rejects malformed secure values', () => {
  assert.throws(() => validateCloudPayload({ ...payload, secureData: { invalid: Number.NaN } }), /non-finite/)
})
