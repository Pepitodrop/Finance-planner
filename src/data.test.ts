import { describe, expect, it } from 'vitest'
import { accountsAcceptanceState } from './acceptance/financeStateFixtures'
import { emptyProductionState, initialState, isLegacyDemoState } from './data'

describe('production financial defaults', () => {
  it('starts every genuine account with no accounts, transactions, goals, or subscriptions', () => {
    expect(emptyProductionState.accounts).toEqual([])
    expect(emptyProductionState.transactions).toEqual([])
    expect(emptyProductionState.goals).toEqual([])
    expect(emptyProductionState.subscriptions ?? []).toEqual([])
  })

  it('never aliases production defaults to acceptance fixture data', () => {
    expect(initialState).toEqual(emptyProductionState)
    expect(initialState.accounts).toHaveLength(0)
    expect(accountsAcceptanceState.accounts.length).toBeGreaterThan(0)
    expect(accountsAcceptanceState).not.toEqual(initialState)
  })

  it('does not bundle or infer the removed legacy starter dataset', () => {
    expect(isLegacyDemoState({ accounts: [], transactions: [], goals: [] })).toBe(false)
  })
})
