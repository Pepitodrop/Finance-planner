import test from 'node:test'
import assert from 'node:assert/strict'
import { assessBankConnectionHealth, chooseBankSyncBackoff } from '../src/bank-sync-health.js'

const now = new Date('2026-08-03T00:00:00Z')

function healthy(overrides = {}) {
  return assessBankConnectionHealth({
    consentExpiresAt: '2026-09-20T00:00:00Z',
    lastSyncedAt: '2026-08-02T12:00:00Z',
    consecutiveFailures: 0,
    accountCount: 3,
    reconciledAccountCount: 3,
    transactionCount: 120,
    pendingTransactionCount: 4,
    duplicateTransactionCount: 0,
    ...overrides,
  }, now)
}

test('healthy connection permits import', () => {
  const result = healthy()
  assert.equal(result.state, 'healthy')
  assert.equal(result.importAllowed, true)
  assert.equal(result.userInterventionRequired, false)
  assert.ok(result.score > 0.9)
})

test('expired consent blocks import and requires reconnection', () => {
  const result = healthy({ consentExpiresAt: '2026-08-02T00:00:00Z' })
  assert.equal(result.state, 'reconnect-required')
  assert.equal(result.nextAction, 'renew-consent')
  assert.equal(result.importAllowed, false)
  assert.equal(result.userInterventionRequired, true)
})

test('incomplete reconciliation fails closed', () => {
  const result = healthy({ reconciledAccountCount: 2 })
  assert.equal(result.state, 'incomplete')
  assert.equal(result.nextAction, 'reconcile-accounts')
  assert.equal(result.importAllowed, false)
})

test('duplicates block import even with otherwise healthy synchronization', () => {
  const result = healthy({ duplicateTransactionCount: 2 })
  assert.equal(result.state, 'degraded')
  assert.equal(result.nextAction, 'deduplicate-before-import')
  assert.equal(result.importAllowed, false)
})

test('provider backoff is exponential and honors bounded retry-after', () => {
  assert.equal(chooseBankSyncBackoff(0), 1_000)
  assert.equal(chooseBankSyncBackoff(3), 8_000)
  assert.equal(chooseBankSyncBackoff(2, 30_000), 30_000)
  assert.equal(chooseBankSyncBackoff(20), 3_600_000)
})
