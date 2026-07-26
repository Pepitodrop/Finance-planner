import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTransactionBalance, normalizeSignedAmount } from '../src/cobol-engine.js'

test('COBOL engine normalizes signed expense amounts', async () => {
  assert.deepEqual(await normalizeSignedAmount(-1299), { type: 'expense', amountCents: 1299 })
})

test('COBOL engine normalizes signed income amounts', async () => {
  assert.deepEqual(await normalizeSignedAmount(250000), { type: 'income', amountCents: 250000 })
})

test('COBOL engine applies deterministic balance changes', async () => {
  assert.equal(await applyTransactionBalance(100000, 1299, 'expense'), 98701)
  assert.equal(await applyTransactionBalance(98701, 5000, 'income'), 103701)
})
