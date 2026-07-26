import { describe, expect, it } from 'vitest'
import { addTransactionToState, deleteTransactionFromState, updateTransactionInState } from './transactionState'
import type { AppState, Transaction } from './types'

const baseState: AppState = {
  accounts: [
    { id: 'checking', name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' },
    { id: 'cash', name: 'Bargeld', type: 'cash', balanceCents: 20_000, currency: 'EUR' },
  ],
  transactions: [],
  goals: [],
}

const expense: Transaction = {
  id: 't1', accountId: 'checking', description: 'Einkauf', category: 'Lebensmittel',
  type: 'expense', amountCents: 5_000, date: '2026-07-26', recurring: false,
}

describe('transaction state mutations', () => {
  it('adds a transaction and adjusts the selected account', () => {
    const next = addTransactionToState(baseState, expense)
    expect(next.accounts[0].balanceCents).toBe(95_000)
    expect(next.transactions).toHaveLength(1)
  })

  it('reverses the previous effect before applying an edit', () => {
    const added = addTransactionToState(baseState, expense)
    const edited = updateTransactionInState(added, { ...expense, accountId: 'cash', type: 'income', amountCents: 8_000 })
    expect(edited.accounts.find((account) => account.id === 'checking')?.balanceCents).toBe(100_000)
    expect(edited.accounts.find((account) => account.id === 'cash')?.balanceCents).toBe(28_000)
  })

  it('reverses the transaction when deleting it', () => {
    const added = addTransactionToState(baseState, expense)
    const result = deleteTransactionFromState(added, expense.id)
    expect(result.state.accounts[0].balanceCents).toBe(100_000)
    expect(result.state.transactions).toHaveLength(0)
    expect(result.deleted.id).toBe(expense.id)
  })
})
