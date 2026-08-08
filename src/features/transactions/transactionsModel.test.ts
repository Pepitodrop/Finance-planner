import { describe, expect, it } from 'vitest'
import type { Account, Transaction } from '../../types'
import { DEFAULT_TRANSACTION_FILTERS, filterTransactions, summarizeExpenseCategories, summarizeTransactions } from './transactionsModel'

const accounts: Account[] = [
  { id: 'checking', name: 'Primary checking', type: 'checking', balanceCents: 0, currency: 'EUR' },
  { id: 'savings', name: 'Long-term savings', type: 'savings', balanceCents: 0, currency: 'EUR' },
]
const transactions: Transaction[] = [
  { id: 'salary', accountId: 'checking', description: 'Salary', category: 'Income', type: 'income', amountCents: 300_000, date: '2026-08-03' },
  { id: 'market', accountId: 'checking', description: 'Neighbourhood market', category: 'Groceries', type: 'expense', amountCents: 12_500, date: '2026-08-02' },
  { id: 'transfer', accountId: 'savings', description: 'Transfer to savings', category: 'Savings', type: 'expense', amountCents: 50_000, date: '2026-08-01' },
  { id: 'prior', accountId: 'checking', description: 'Prior rent', category: 'Housing', type: 'expense', amountCents: 80_000, date: '2026-06-01' },
]
const referenceDate = new Date(2026, 7, 4)

describe('transactions model', () => {
  it('searches description, category and account name', () => {
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, query: 'market' }, referenceDate).map(({ id }) => id)).toEqual(['market'])
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, query: 'groceries' }, referenceDate).map(({ id }) => id)).toEqual(['market'])
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, query: 'primary checking' }, referenceDate).map(({ id }) => id)).toEqual(['salary', 'market'])
  })

  it('supports all presentation type filters while retaining inferred transfers', () => {
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, type: 'income' }, referenceDate).map(({ id }) => id)).toEqual(['salary'])
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, type: 'expense' }, referenceDate).map(({ id }) => id)).toEqual(['market'])
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, type: 'transfer' }, referenceDate).map(({ id }) => id)).toEqual(['transfer'])
  })

  it('applies date, category, account and amount filters deterministically', () => {
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, date: 'all' }, referenceDate)).toHaveLength(4)
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, category: 'Groceries' }, referenceDate).map(({ id }) => id)).toEqual(['market'])
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, account: 'savings' }, referenceDate).map(({ id }) => id)).toEqual(['transfer'])
    expect(filterTransactions(transactions, accounts, { ...DEFAULT_TRANSACTION_FILTERS, amount: 'large' }, referenceDate).map(({ id }) => id)).toEqual(['salary', 'transfer'])
  })

  it('excludes detected transfers from expense totals, net and category breakdowns', () => {
    expect(summarizeTransactions(transactions)).toEqual({ incomeCents: 300_000, expenseCents: 92_500, netCents: 207_500 })
    const categories = summarizeExpenseCategories(transactions)
    expect(categories.map(({ name }) => name)).not.toContain('Savings')
    expect(categories.reduce((sum, item) => sum + item.amountCents, 0)).toBe(92_500)
  })
})
