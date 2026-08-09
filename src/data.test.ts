import { describe, expect, it } from 'vitest'
import { accountsAcceptanceState, emptyProductionState, initialState, isLegacyDemoState, removeLegacyDemoState } from './data'
import type { AppState } from './types'

describe('production financial defaults', () => {
  it('starts a genuine account with no accounts, transactions, or goals', () => {
    expect(emptyProductionState.accounts).toEqual([])
    expect(emptyProductionState.transactions).toEqual([])
    expect(emptyProductionState.goals).toEqual([])
  })

  it('never aliases production defaults to seeded acceptance data', () => {
    expect(initialState).toEqual(emptyProductionState)
    expect(initialState.accounts).toHaveLength(0)
    expect(accountsAcceptanceState.accounts.length).toBeGreaterThan(0)
    expect(accountsAcceptanceState).not.toEqual(initialState)
  })

  it('recognizes and removes the exact legacy starter dataset persisted by older releases', () => {
    const legacy: AppState = {
      accounts: [
        { id: 'account-checking', name: 'Girokonto', type: 'checking', balanceCents: 286450, currency: 'EUR' },
        { id: 'account-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 420000, currency: 'EUR' },
        { id: 'account-cash', name: 'Bargeld', type: 'cash', balanceCents: 8500, currency: 'EUR' },
      ],
      transactions: [{ id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true }],
      goals: [
        { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
        { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
      ],
    }
    expect(isLegacyDemoState(legacy)).toBe(true)
    expect(removeLegacyDemoState(legacy)).toEqual(emptyProductionState)
  })

  it('does not delete genuine user data that merely uses a similar name', () => {
    const real: AppState = {
      accounts: [{ id: 'real-checking', name: 'Girokonto', type: 'checking', balanceCents: 10000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    expect(isLegacyDemoState(real)).toBe(false)
    expect(removeLegacyDemoState(real)).toBe(real)
  })
})
