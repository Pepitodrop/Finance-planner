import assert from 'node:assert/strict'
import test from 'node:test'
import { CobolBankingCore, normalizeAccountTypeFallback, normalizeCreditCardFallback } from '../src/cobol-banking-core.js'

test('normalizes German and provider account type aliases', () => {
  assert.equal(normalizeAccountTypeFallback('Girokonto'), 'checking')
  assert.equal(normalizeAccountTypeFallback('Kreditkarte'), 'credit-card')
  assert.equal(normalizeAccountTypeFallback('brokerage'), 'investment')
})

test('normalizes a positive provider card debt to a negative ledger liability', () => {
  assert.deepEqual(normalizeCreditCardFallback({ providerBalanceCents: 125_50, creditLimitCents: 500_00, pendingAmountCents: 20_00 }), {
    amountOwedCents: 125_50,
    ledgerBalanceCents: -125_50,
    availableCreditCents: 354_50,
    pendingAmountCents: 20_00,
  })
})

test('normalizes a negative provider card balance without double-negating debt', () => {
  assert.deepEqual(normalizeCreditCardFallback({ providerBalanceCents: -125_50 }), {
    amountOwedCents: 125_50,
    ledgerBalanceCents: -125_50,
    availableCreditCents: undefined,
    pendingAmountCents: 0,
  })
})

test('adapter safely falls back when the COBOL binary is unavailable', async () => {
  const core = new CobolBankingCore({ binary: '/definitely/not/installed/banking-core', required: false })
  assert.equal(await core.normalizeAccountType('Sparkonto'), 'savings')
  assert.equal((await core.normalizeCreditCard({ providerBalanceCents: 90_00, creditLimitCents: 100_00 })).availableCreditCents, 10_00)
})
