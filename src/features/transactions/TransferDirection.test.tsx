import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, Transaction } from '../../types'
import { AccountsPage } from '../accounts/AccountsPage'
import { TransactionsPage } from './TransactionsPage'

const accounts: Account[] = [
  { id: 'checking', name: 'Test Girokonto', type: 'checking', balanceCents: 700000, currency: 'EUR' },
  { id: 'savings', name: 'Test Tagesgeld', type: 'savings', balanceCents: 1500000, currency: 'EUR' },
]

const transfers: Transaction[] = [
  { id: 'out', accountId: 'checking', description: 'Transfer to savings', category: 'Transfer', type: 'expense', amountCents: 30000, date: '2026-08-25' },
  { id: 'in', accountId: 'savings', description: 'Transfer from checking', category: 'Transfer', type: 'income', amountCents: 30000, date: '2026-08-25' },
]

afterEach(() => cleanup())

describe('transfer amount direction', () => {
  it('keeps transfer presentation while showing outgoing minus and incoming plus in Transactions', () => {
    render(<TransactionsPage
      transactions={transfers}
      accounts={accounts}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      referenceDate={new Date(2026, 7, 25)}
    />)

    const incomingRow = screen.getAllByText('Transfer from checking')[0].closest('tr')!
    const outgoingRow = screen.getAllByText('Transfer to savings')[0].closest('tr')!

    expect(incomingRow).toHaveTextContent(/\+300,00\s*€/)
    expect(outgoingRow).toHaveTextContent(/−300,00\s*€/)
    expect(within(incomingRow).getAllByText('Transfer').length).toBeGreaterThan(0)
    expect(within(outgoingRow).getAllByText('Transfer').length).toBeGreaterThan(0)
  })

  it('shows an incoming transfer as positive in the destination account detail', () => {
    render(<AccountsPage
      accounts={accounts}
      transactions={transfers}
      initialSelectedAccountId="savings"
      onOpenConnections={vi.fn()}
      onViewTransactions={vi.fn()}
    />)

    const recent = screen.getByRole('list', { name: 'Recent account transactions' })
    expect(recent).toHaveTextContent(/transfer:\s*\+300,00\s*€/i)
  })
})
