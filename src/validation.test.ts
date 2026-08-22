import { describe, expect, it } from 'vitest'
import { isAppState, validateTransactionInput } from './validation'

describe('runtime validation', () => {
  it('rejects transactions referencing missing accounts', () => {
    expect(isAppState({
      accounts: [],
      transactions: [{ id: 't', accountId: 'missing', description: 'Test', category: 'Sonstiges', type: 'expense', amountCents: 100, date: '2026-07-01' }],
      goals: [],
    })).toBe(false)
  })

  it('accepts a valid empty state', () => {
    expect(isAppState({ accounts: [], transactions: [], goals: [] })).toBe(true)
  })

  it('accepts credit-card accounts used by the liability UI', () => {
    expect(isAppState({
      accounts: [{ id: 'card-1', name: 'Test Kreditkarte', type: 'credit-card', balanceCents: -84530, currency: 'EUR' }],
      transactions: [{ id: 'tx-1', accountId: 'card-1', description: 'Test Streaming', category: 'Subscriptions', type: 'expense', amountCents: 1799, date: '2026-08-08', recurring: true }],
      goals: [],
    })).toBe(true)
  })

  it('rejects non-positive amounts', () => {
    expect(validateTransactionInput({ accountId: 'a', description: 'Test', category: 'Sonstiges', amount: 0, date: '2026-07-01' })).not.toBeNull()
  })
})
