import assert from 'node:assert/strict'
import test from 'node:test'
import { createBankingSyncNormalizer } from '../src/banking-sync-normalizer.js'

const core = {
  async normalizeAccountType(value) {
    return value === 'card' ? 'credit-card' : value
  },
  async normalizeCreditCard() {
    return {
      amountOwedCents: 12_550,
      ledgerBalanceCents: -12_550,
      availableCreditCents: 35_450,
      pendingAmountCents: 2_000,
    }
  },
}

test('normalizes provider credit-card balances through the banking core', async () => {
  const normalize = createBankingSyncNormalizer({ core })
  const result = await normalize({
    accounts: [{
      externalId: 'card-1',
      name: 'Visa',
      type: 'card',
      balanceCents: 12_550,
      creditLimitCents: 50_000,
      pendingAmountCents: -2_000,
      currency: 'EUR',
    }],
    transactions: [],
  })

  assert.deepEqual(result.accounts[0], {
    externalId: 'card-1',
    name: 'Visa',
    type: 'credit-card',
    balanceCents: -12_550,
    creditLimitCents: 50_000,
    amountOwedCents: 12_550,
    availableCreditCents: 35_450,
    pendingAmountCents: 2_000,
    currency: 'EUR',
  })
})

test('preserves normalized asset accounts and validates their balance', async () => {
  const normalize = createBankingSyncNormalizer({ core })
  const result = await normalize({ accounts: [{ type: 'checking', balanceCents: 42_00, currency: 'EUR' }], transactions: [] })
  assert.equal(result.accounts[0].balanceCents, 42_00)
  assert.equal(result.accounts[0].type, 'checking')
})

test('rejects unsafe provider money before invoking financial logic', async () => {
  const normalize = createBankingSyncNormalizer({ core })
  await assert.rejects(() => normalize({ accounts: [{ type: 'checking', balanceCents: Number.MAX_VALUE, currency: 'EUR' }] }), /safe integer/)
})
