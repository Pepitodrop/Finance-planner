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

  it('rejects non-positive amounts', () => {
    expect(validateTransactionInput({ accountId: 'a', description: 'Test', category: 'Sonstiges', amount: 0, date: '2026-07-01' })).not.toBeNull()
  })
})
