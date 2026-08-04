import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../types'
import { Dashboard } from './Dashboard'

const populatedState: AppState = {
  accounts: [{ id: 'account', name: 'An account name deliberately long enough to truncate safely', type: 'checking', balanceCents: 12_345_678, currency: 'EUR' }],
  transactions: [
    { id: 'income', accountId: 'account', description: 'Consulting payment with a deliberately long description', category: 'Income', type: 'income', amountCents: 300_000, date: '2026-08-03' },
    { id: 'expense', accountId: 'account', description: 'Groceries', category: 'Food', type: 'expense', amountCents: 45_000, date: '2026-08-02' },
  ],
  goals: [{ id: 'goal', name: 'Emergency fund', targetCents: 1_000_000, currentCents: 500_000, targetDate: '2027-01-01' }],
}

function renderDashboard(state = populatedState) {
  const onAddTransaction = vi.fn()
  const onEditTransaction = vi.fn()
  const onNavigate = vi.fn()
  render(<Dashboard
    state={state}
    userName="Alex Rivera"
    onAddTransaction={onAddTransaction}
    onEditTransaction={onEditTransaction}
    onNavigate={onNavigate}
    referenceDate={new Date(2026, 7, 4, 19)}
  />)
  return { onAddTransaction, onEditTransaction, onNavigate }
}

describe('Dashboard', () => {
  afterEach(cleanup)

  it('declares an English language boundary for the redesigned feature', () => {
    renderDashboard()
    expect(document.querySelector('[data-dashboard-ready="true"]')).toHaveAttribute('lang', 'en')
  })

  it('renders canonical English structure and genuine summary values without fabricated trends', () => {
    renderDashboard()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText(/Good evening, Alex/)).toBeInTheDocument()
    expect(screen.getByText('August 2026')).toBeInTheDocument()
    expect(screen.getByText('Income').closest('article')).toHaveTextContent('+3.000,00 €')
    expect(screen.getByText('Expenses').closest('article')).toHaveTextContent('−450,00 €')
    expect(screen.getByText('Surplus').closest('article')).toHaveTextContent('+2.550,00 €')
    expect(screen.queryByText(/last month|versus|vs\.|trend/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Finanzübersicht|Gesamtvermögen|Sparziele/)).not.toBeInTheDocument()
  })

  it('labels projection semantics and exposes a textual alternative', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: 'Balance projection' })).toBeInTheDocument()
    expect(screen.getByText('Next 12 months')).toBeInTheDocument()
    expect(screen.getByText(/starts with your current account balance/i)).toBeInTheDocument()
    expect(screen.getByText(/It is not historical or investment performance/i)).toBeInTheDocument()
    expect(screen.getByText(/The projected balance after 12 months/i)).toBeInTheDocument()
  })

  it('renders account, goal, category, and recent-transaction previews from state', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(screen.getAllByText(/An account name deliberately long/).length).toBeGreaterThan(0)
    expect(screen.getByRole('progressbar', { name: 'Emergency fund: 50% saved' })).toHaveAttribute('aria-valuenow', '50')
    const categorySection = screen.getByRole('heading', { name: 'Expenses by category' }).closest('article')
    expect(categorySection).not.toBeNull()
    expect(within(categorySection!).getByText('Food')).toBeInTheDocument()
    expect(categorySection).toHaveTextContent('Current-month category total 450,00 €')
    expect(screen.getByRole('button', { name: /Edit Consulting payment/ })).toBeInTheDocument()
  })

  it('keeps Add transaction and genuine destination actions functional', async () => {
    const user = userEvent.setup()
    const { onAddTransaction, onNavigate } = renderDashboard()
    await user.click(within(document.querySelector('.dashboard-toolbar')!).getByRole('button', { name: 'Add transaction' }))
    expect(onAddTransaction).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'View all' }))
    expect(onNavigate).toHaveBeenCalledWith('transactions')
    await user.click(screen.getByRole('button', { name: 'Manage goals' }))
    expect(onNavigate).toHaveBeenCalledWith('goals')
  })

  it('renders meaningful empty states without dead Accounts navigation', async () => {
    const user = userEvent.setup()
    const { onAddTransaction, onNavigate } = renderDashboard({ accounts: [], transactions: [], goals: [] })
    expect(screen.getByText('No accounts recorded')).toBeInTheDocument()
    expect(screen.getByText('No savings goals yet')).toBeInTheDocument()
    expect(screen.getByText('No transactions yet')).toBeInTheDocument()
    expect(screen.getByText('No expenses this month')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View all accounts/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Connections' }))
    expect(onNavigate).toHaveBeenCalledWith('connections')
    await user.click(within(document.querySelector('.dashboard-toolbar')!).getByRole('button', { name: 'Add transaction' }))
    expect(onAddTransaction).toHaveBeenCalledOnce()
  })
})
