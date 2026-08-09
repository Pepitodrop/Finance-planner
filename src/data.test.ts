import { describe, expect, it } from 'vitest'
import { accountsAcceptanceState, emptyProductionState, initialState } from './data'

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
})
