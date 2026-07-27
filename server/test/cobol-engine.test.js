import test from 'node:test'
import assert from 'node:assert/strict'
import { applyTransactionBalance, normalizeSignedAmount, projectSavingsBalance } from '../src/cobol-engine.js'

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

test('COBOL engine projects savings from monthly contributions', async () => {
  assert.equal(await projectSavingsBalance(100000, 25000, 12), 400000)
  assert.equal(await projectSavingsBalance(100000, -5000, 6), 70000)
})

test('savings projection rejects invalid month ranges before invoking COBOL', async () => {
  await assert.rejects(() => projectSavingsBalance(100000, 25000, 1201), /between 0 and 1200/)
})
