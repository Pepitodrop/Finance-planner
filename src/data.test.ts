import { describe, expect, it } from 'vitest'
import { accountsAcceptanceState, emptyProductionState, initialState, isLegacyDemoState, removeLegacyDemoState } from './data'
import type { AppState } from './types'

function legacyState(): AppState {
  return {
    accounts: [
      { id: 'account-checking', name: 'Girokonto', type: 'checking', balanceCents: 286450, currency: 'EUR' },
      { id: 'account-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 420000, currency: 'EUR' },
      { id: 'account-cash', name: 'Bargeld', type: 'cash', balanceCents: 8500, currency: 'EUR' },
    ],
    transactions: [
      { id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
      { id: 't8', accountId: 'account-checking', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 9000, date: '2026-07-30' },
    ],
    goals: [
      { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
      { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
    ],
  }
}

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

  it('recognizes and removes only the untouched legacy starter-data family persisted by older releases', () => {
    const legacy = legacyState()
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

  it('preserves a legacy-looking state once the user has added a real transaction', () => {
    const modified = legacyState()
    modified.transactions.push({ id: '2cc5a626-50d5-42f3-8eea-1841189b87ab', accountId: 'account-checking', description: 'My purchase', category: 'Other', type: 'expense', amountCents: 1234, date: '2026-08-09' })
    expect(isLegacyDemoState(modified)).toBe(false)
    expect(removeLegacyDemoState(modified)).toBe(modified)
  })

  it('preserves a legacy-looking state once the user has added an account or changed an original balance', () => {
    const extraAccount = legacyState()
    extraAccount.accounts.push({ id: 'real-savings', name: 'My savings', type: 'savings', balanceCents: 5000, currency: 'EUR' })
    expect(isLegacyDemoState(extraAccount)).toBe(false)

    const changedBalance = legacyState()
    changedBalance.accounts[0].balanceCents += 100
    expect(isLegacyDemoState(changedBalance)).toBe(false)
  })
})
