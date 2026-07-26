import { describe, expect, it } from 'vitest'
import { assessBankConnectionReadiness, importBankTransactions, type BankSyncState } from './bankConnection'

const readyState: BankSyncState = {
  consent: {
    provider: 'sandbox-bank',
    status: 'active',
    scopes: ['accounts', 'balances', 'transactions'],
    expiresAt: '2026-12-31T00:00:00.000Z',
  },
  connectedAccounts: 2,
  lastSuccessfulSyncAt: '2026-07-26T10:00:00.000Z',
  paginationComplete: true,
  idempotencyVerified: true,
  retryPolicyConfigured: true,
  webhookSignatureVerified: true,
}

describe('bank connection readiness', () => {
  it('requires a complete and fresh consent-backed sync', () => {
    const report = assessBankConnectionReadiness(readyState, new Date('2026-07-26T12:00:00.000Z'))
    expect(report.productionReady).toBe(true)
    expect(report.score).toBe(100)
  })

  it('blocks stale or incomplete integrations', () => {
    const report = assessBankConnectionReadiness({
      ...readyState,
      consent: { ...readyState.consent, scopes: ['accounts'] },
      lastSuccessfulSyncAt: '2026-07-20T10:00:00.000Z',
      webhookSignatureVerified: false,
    }, new Date('2026-07-26T12:00:00.000Z'))
    expect(report.productionReady).toBe(false)
    expect(report.failed.length).toBeGreaterThanOrEqual(3)
  })

  it('rejects future-dated sync timestamps', () => {
    const report = assessBankConnectionReadiness({
      ...readyState,
      lastSuccessfulSyncAt: '2026-07-27T12:00:00.000Z',
    }, new Date('2026-07-26T12:00:00.000Z'))
    expect(report.productionReady).toBe(false)
    expect(report.failed).toContain('Successful sync within 24 hours')
  })
})

describe('bank transaction import', () => {
  it('normalizes signs and prevents duplicate imports', () => {
    const first = importBankTransactions('sandbox-bank', [
      {
        providerTransactionId: 'tx-1',
        accountId: 'account-1',
        description: ' Supermarkt ',
        bookedAt: '2026-07-25T12:00:00Z',
        amountCents: -4299,
        currency: 'EUR',
      },
    ], [])
    expect(first.imported[0]).toMatchObject({
      id: 'bank:sandbox-bank:tx-1',
      type: 'expense',
      amountCents: 4299,
      description: 'Supermarkt',
    })

    const second = importBankTransactions('sandbox-bank', [
      {
        providerTransactionId: 'tx-1',
        accountId: 'account-1',
        description: 'Supermarkt',
        bookedAt: '2026-07-25T12:00:00Z',
        amountCents: -4299,
        currency: 'EUR',
      },
    ], first.imported)
    expect(second.imported).toEqual([])
    expect(second.duplicates).toBe(1)
  })

  it('rejects unsupported currencies instead of silently converting them', () => {
    const result = importBankTransactions('sandbox-bank', [{
      providerTransactionId: 'usd-1',
      accountId: 'account-1',
      description: 'Foreign transaction',
      bookedAt: '2026-07-25',
      amountCents: -1000,
      currency: 'USD',
    }], [])
    expect(result.imported).toEqual([])
    expect(result.rejected).toEqual(['usd-1'])
  })
})