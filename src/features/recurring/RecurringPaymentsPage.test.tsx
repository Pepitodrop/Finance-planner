import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecurringPaymentsPage } from './RecurringPaymentsPage'

describe('RecurringPaymentsPage', () => {
  it('has an English boundary and no unsupported cancellation control', () => { render(<RecurringPaymentsPage transactions={[{ id: 'e', accountId: 'a', description: 'Rent', category: 'Housing', type: 'expense', amountCents: 90_000, date: '2026-01-01', recurring: true }]} onAddTransaction={vi.fn()} onViewTransactions={vi.fn()}/>); expect(screen.getByRole('main')).toHaveAttribute('lang', 'en'); expect(screen.queryByText(/cancel subscription/i)).not.toBeInTheDocument() })
  it('offers genuine actions when empty', () => { render(<RecurringPaymentsPage transactions={[]} onAddTransaction={vi.fn()} onViewTransactions={vi.fn()}/>); expect(screen.getByRole('button', { name: /add a transaction/i })).toBeInTheDocument(); expect(screen.getByRole('button', { name: /view transactions/i })).toBeInTheDocument() })
})
