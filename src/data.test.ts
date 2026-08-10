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
      { id: 't1', accountId: 'account-checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 185000, date: '2026-07-01', recurring: true },
      { id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
      { id: 't3', accountId: 'account-checking', description: 'Supermarkt', category: 'Lebensmittel', type: 'expense', amountCents: 6840, date: '2026-07-08' },
      { id: 't4', accountId: 'account-checking', description: 'Fitnessstudio', category: 'Verträge', type: 'expense', amountCents: 2990, date: '2026-07-10', recurring: true },
      { id: 't5', accountId: 'account-checking', description: 'Deutschlandticket', category: 'Mobilität', type: 'expense', amountCents: 5800, date: '2026-07-12', recurring: true },
      { id: 't6', accountId: 'account-checking', description: 'Werkstudentenjob', category: 'Einkommen', type: 'income', amountCents: 62000, date: '2026-07-15', recurring: true },
      { id: 't7', accountId: 'account-checking', description: 'Restaurant', category: 'Freizeit', type: 'expense', amountCents: 4200, date: '2026-07-18' },
    ],
    goals: [
      { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
      { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
    ],
  }
}

describe('production financial defaults', () => {
  it('starts a genuine account with no accounts, transactions, goals, or subscriptions', () => {
    expect(emptyProductionState.accounts).toEqual([])
    expect(emptyProductionState.transactions).toEqual([])
    expect(emptyProductionState.goals).toEqual([])
    expect(emptyProductionState.subscriptions ?? []).toEqual([])
  })

  it('never aliases production defaults to seeded acceptance data', () => {
    expect(initialState).toEqual(emptyProductionState)
    expect(initialState.accounts).toHaveLength(0)
    expect(accountsAcceptanceState.accounts.length).toBeGreaterThan(0)
    expect(accountsAcceptanceState).not.toEqual(initialState)
  })

  it('recognizes and removes only the exact untouched legacy starter dataset', () => {
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

  it('preserves a legacy-looking state when an added transaction still uses the old tN id pattern', () => {
    const modified = legacyState()
    modified.transactions.push({ id: 't8', accountId: 'account-checking', description: 'My purchase', category: 'Other', type: 'expense', amountCents: 1234, date: '2026-08-09' })
    expect(isLegacyDemoState(modified)).toBe(false)
    expect(removeLegacyDemoState(modified)).toBe(modified)
  })

  it('preserves a legacy-looking state after any material transaction field is edited', () => {
    const mutations: Array<(state: AppState) => void> = [
      (state) => { state.transactions[0].amountCents += 1 },
      (state) => { state.transactions[0].description = 'Edited salary' },
      (state) => { state.transactions[0].date = '2026-07-02' },
      (state) => { state.transactions[0].category = 'Other income' },
      (state) => { state.transactions[0].type = 'expense' },
      (state) => { state.transactions[0].recurring = false },
      (state) => { state.transactions[0].accountId = 'account-savings' },
    ]

    for (const mutate of mutations) {
      const modified = legacyState()
      mutate(modified)
      expect(isLegacyDemoState(modified)).toBe(false)
      expect(removeLegacyDemoState(modified)).toBe(modified)
    }
  })

  it('preserves a legacy-looking state when a canonical transaction is removed or replaced', () => {
    const removed = legacyState()
    removed.transactions.splice(2, 1)
    expect(isLegacyDemoState(removed)).toBe(false)
    expect(removeLegacyDemoState(removed)).toBe(removed)

    const replaced = legacyState()
    replaced.transactions[2] = { id: 't8', accountId: 'account-checking', description: 'Replacement', category: 'Other', type: 'expense', amountCents: 5000, date: '2026-07-08' }
    expect(isLegacyDemoState(replaced)).toBe(false)
    expect(removeLegacyDemoState(replaced)).toBe(replaced)
  })

  it('preserves a legacy-looking state once the user has added an account or changed an original balance', () => {
    const extraAccount = legacyState()
    extraAccount.accounts.push({ id: 'real-savings', name: 'My savings', type: 'savings', balanceCents: 5000, currency: 'EUR' })
    expect(isLegacyDemoState(extraAccount)).toBe(false)

    const changedBalance = legacyState()
    changedBalance.accounts[0].balanceCents += 100
    expect(isLegacyDemoState(changedBalance)).toBe(false)
  })

  it('preserves a legacy-looking state when an original account gained provider metadata', () => {
    const modified = legacyState()
    modified.accounts[0].institutionId = 'user-bank-connection'
    expect(isLegacyDemoState(modified)).toBe(false)
    expect(removeLegacyDemoState(modified)).toBe(modified)
  })

  it('preserves subscriptions instead of treating a subscribed user as untouched demo data', () => {
    const modified = legacyState()
    modified.subscriptions = [{
      id: 'subscription-1',
      provider: 'Example provider',
      product: 'Example plan',
      amountCents: 999,
      currency: 'EUR',
      billingInterval: 'monthly',
      status: 'active',
      source: 'manual',
    }]
    expect(isLegacyDemoState(modified)).toBe(false)
    expect(removeLegacyDemoState(modified)).toBe(modified)
  })
})
