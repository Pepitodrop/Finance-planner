import assert from 'node:assert/strict'
import test from 'node:test'
import {
  gocardlessConsentExpiresAt,
  syncGoCardless,
  syncWindow,
  validateProviderReconciliation,
} from '../src/providers.js'

test('computes the exact GoCardless consent expiry from the activated connection', () => {
  assert.equal(
    gocardlessConsentExpiresAt({ connectedAt: '2026-01-01T00:00:00.000Z', accessValidForDays: 90 }),
    '2026-04-01T00:00:00.000Z',
  )
  assert.equal(gocardlessConsentExpiresAt({}), null)
  assert.throws(() => gocardlessConsentExpiresAt({ connectedAt: '2026-01-01T00:00:00Z', accessValidForDays: 1000 }), /duration/i)
})

test('rejects expired consent before making a provider request', async () => {
  const originalFetch = globalThis.fetch
  let requested = false
  globalThis.fetch = async () => { requested = true; throw new Error('must not be called') }
  try {
    await assert.rejects(() => syncGoCardless({
      connectedAt: '2020-01-01T00:00:00.000Z',
      accessValidForDays: 90,
      token: { access: 'secret' },
      requisitionId: 'req-1',
    }, {}), /consent expired/i)
    assert.equal(requested, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('uses an overlap window while keeping the synchronization range bounded', () => {
  const window = syncWindow('2026-07-25T12:00:00.000Z', new Date('2026-08-01T12:00:00.000Z'), 31, 3)
  assert.equal(window.dateFrom, '2026-07-22')
  assert.equal(window.dateTo, '2026-08-01')
})

test('accepts reconciled normalized data and rejects count or identifier drift', () => {
  const valid = {
    accounts: [{ externalId: 'a1', currency: 'EUR' }],
    transactions: [{ externalId: 't1', amountCents: -1234, currency: 'EUR' }],
    reconciliation: { accountCount: 1, transactionCount: 1, dateFrom: '2026-07-01', dateTo: '2026-08-01' },
  }
  assert.equal(validateProviderReconciliation(valid), true)
  assert.throws(() => validateProviderReconciliation({ ...valid, reconciliation: { ...valid.reconciliation, transactionCount: 2 } }), /transaction count/i)
  assert.throws(() => validateProviderReconciliation({
    ...valid,
    transactions: [valid.transactions[0], valid.transactions[0]],
    reconciliation: { ...valid.reconciliation, transactionCount: 2 },
  }), /duplicate/i)
  assert.throws(() => validateProviderReconciliation({ ...valid, reconciliation: { ...valid.reconciliation, dateFrom: '2026-09-01' } }), /reversed/i)
})
