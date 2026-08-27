import { describe, expect, it } from 'vitest'
import { removeAccountFromState, restoreAccountToState } from './accountState'
import type { AppState } from './types'

const state: AppState = {
  accounts: [
    { id: 'account-1', name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' },
    { id: 'account-2', name: 'Tagesgeld', type: 'savings', balanceCents: 500_000, currency: 'EUR' },
  ],
  transactions: [
    { id: 'tx-1', accountId: 'account-1', description: 'REWE', category: 'Lebensmittel', type: 'expense', amountCents: 4299, date: '2026-07-31' },
    { id: 'tx-2', accountId: 'account-1', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 300_000, date: '2026-07-25' },
    { id: 'tx-3', accountId: 'account-2', description: 'Zinsen', category: 'Einkommen', type: 'income', amountCents: 500, date: '2026-07-20' },
  ],
  goals: [],
}

describe('removeAccountFromState', () => {
  it('removes exactly the target account and every transaction referencing it, leaving unrelated accounts/transactions untouched', () => {
    const result = removeAccountFromState(state, 'account-1')
    expect(result.state.accounts.map((account) => account.id)).toEqual(['account-2'])
    expect(result.state.transactions.map((transaction) => transaction.id)).toEqual(['tx-3'])
    expect(result.deletedAccount.id).toBe('account-1')
    expect(result.deletedTransactions.map((transaction) => transaction.id).sort()).toEqual(['tx-1', 'tx-2'])
  })

  it('never leaves an orphan transaction referencing a removed account', () => {
    const result = removeAccountFromState(state, 'account-1')
    const accountIds = new Set(result.state.accounts.map((account) => account.id))
    for (const transaction of result.state.transactions) expect(accountIds.has(transaction.accountId)).toBe(true)
  })

  it('handles an account with zero transactions', () => {
    const noTransactions: AppState = { ...state, transactions: [] }
    const result = removeAccountFromState(noTransactions, 'account-2')
    expect(result.deletedTransactions).toEqual([])
    expect(result.state.accounts.map((account) => account.id)).toEqual(['account-1'])
  })

  it('throws for an account id that does not exist, rather than silently no-op removing nothing', () => {
    expect(() => removeAccountFromState(state, 'does-not-exist')).toThrow()
  })

  it('does not mutate the input state', () => {
    const before = structuredClone(state)
    removeAccountFromState(state, 'account-1')
    expect(state).toEqual(before)
  })
})

describe('restoreAccountToState', () => {
  it('reverses removeAccountFromState() exactly', () => {
    const removed = removeAccountFromState(state, 'account-1')
    const restored = restoreAccountToState(removed.state, removed.deletedAccount, removed.deletedTransactions)
    expect(restored.accounts.map((account) => account.id).sort()).toEqual(['account-1', 'account-2'])
    expect(restored.transactions.map((transaction) => transaction.id).sort()).toEqual(['tx-1', 'tx-2', 'tx-3'])
  })
})
