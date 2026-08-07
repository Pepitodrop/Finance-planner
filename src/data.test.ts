import { describe, expect, it } from 'vitest'
import { emptyProductionState, initialState } from './data'

describe('emptyProductionState', () => {
  it('is genuinely empty (no accounts, transactions, or goals)', () => {
    expect(emptyProductionState.accounts).toEqual([])
    expect(emptyProductionState.transactions).toEqual([])
    expect(emptyProductionState.goals).toEqual([])
  })

  it('is a distinct dataset from the seeded demo state used by the reset-to-demo feature', () => {
    expect(emptyProductionState).not.toEqual(initialState)
    expect(initialState.accounts.length).toBeGreaterThan(0)
  })
})
