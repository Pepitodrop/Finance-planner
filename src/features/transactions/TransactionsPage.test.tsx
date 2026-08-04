import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, Transaction } from '../../types'
import { TransactionsPage } from './TransactionsPage'

const accounts: Account[] = [{ id: 'account', name: 'Primary checking account with a long name', type: 'checking', balanceCents: 0, currency: 'EUR' }]
const transactions: Transaction[] = [
  { id: 'income', accountId: 'account', description: 'Annual consulting settlement with a deliberately long description', category: 'Income', type: 'income', amountCents: 12_543_075, date: '2026-08-04' },
  { id: 'expense', accountId: 'account', description: 'Market', category: 'Groceries', type: 'expense', amountCents: 18_745, date: '2026-08-03' },
  { id: 'transfer', accountId: 'account', description: 'Transfer to savings', category: 'Savings', type: 'expense', amountCents: 50_000, date: '2026-08-02' },
]

function setup(overrides: Partial<ComponentProps<typeof TransactionsPage>> = {}) {
  const callbacks = { onAdd: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }
  const view = render(<TransactionsPage transactions={transactions} accounts={accounts} referenceDate={new Date(2026, 7, 4)} {...callbacks} {...overrides}/>)
  return { ...view, ...callbacks }
}

afterEach(() => { cleanup(); document.body.style.overflow = ''; document.querySelector('.app-shell__frame')?.remove(); document.querySelector('.app-mobile-navigation')?.remove() })

describe('TransactionsPage', () => {
  it('declares its English boundary and accessible heading hierarchy', () => {
    const { container } = setup()
    expect(container.querySelector('[data-transactions-ready="true"]')).toHaveAttribute('lang', 'en')
    expect(screen.getByRole('heading', { level: 1, name: 'Transactions' })).toBeInTheDocument()
    expect(screen.queryByText(/Transaktionen|Ausgaben|Einnahmen/)).not.toBeInTheDocument()
  })

  it('renders a semantic desktop table and semantic mobile list without bulk controls', () => {
    setup()
    expect(screen.getByRole('table', { name: 'Filtered transactions' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Filtered transactions' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Date', 'Description', 'Category', 'Account', 'Amount', 'Actions'])
  })

  it('filters search results and resets to the complete current-month scope', () => {
    setup()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search transactions' }), { target: { value: 'Market' } })
    expect(screen.getAllByText('Market')).toHaveLength(2)
    expect(screen.queryByText(/Annual consulting/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getAllByText(/Annual consulting/)).toHaveLength(2)
  })

  it('shows honest transfer semantics and excludes transfers from displayed expenses', () => {
    setup()
    const summary = screen.getByRole('heading', { name: 'Summary' }).closest('section')!
    expect(within(summary).getByText((_, element) => element?.tagName === 'DD' && element.textContent?.replace(/\s/g, ' ') === '−187,45 €')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Transfers' }))
    expect(screen.getByText(/Transfers are inferred/)).toBeInTheDocument()
    expect(within(summary).getByText((_, element) => element?.tagName === 'DD' && element.textContent?.replace(/\s/g, ' ') === '−0,00 €')).toBeInTheDocument()
  })

  it('uses existing Add, Edit and Delete callbacks', () => {
    const { onAdd, onEdit, onDelete } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Add transaction' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Market' })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Actions for Market' })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onAdd).toHaveBeenCalledOnce()
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'expense' }))
    expect(onDelete).toHaveBeenCalledWith('expense')
  })

  it('opens a draft filter sheet, applies changes, and restores trigger focus', async () => {
    const { container } = setup()
    const frame = document.createElement('div'); frame.className = 'app-shell__frame'; document.body.prepend(frame)
    const nav = document.createElement('nav'); nav.className = 'app-mobile-navigation'; document.body.append(nav)
    const trigger = container.querySelector<HTMLButtonElement>('.transactions-filter-trigger--mobile')!
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Filters' })
    expect(frame).toHaveAttribute('inert')
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'Groceries' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply filters' }))
    await vi.waitFor(() => expect(trigger).toHaveFocus())
    expect(screen.queryByText(/Annual consulting/)).not.toBeInTheDocument()
    frame.remove(); nav.remove()
  })

  it('keeps applied filters when Cancel or Escape closes the draft sheet', async () => {
    const { container } = setup()
    const trigger = container.querySelector<HTMLButtonElement>('.transactions-filter-trigger--mobile')!
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('dialog', { name: 'Filters' }).querySelector('select')!, { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Filters' })).not.toBeInTheDocument())
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    await vi.waitFor(() => expect(trigger).toHaveFocus())
  })

  it('renders meaningful empty states', () => {
    setup({ transactions: [] })
    expect(screen.getByText('No transactions yet')).toBeInTheDocument()
    expect(screen.getByText('No matching expenses')).toBeInTheDocument()
  })
})
