import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataTools } from './DataTools'
import type { AppState } from './types'

afterEach(cleanup)

const state: AppState = {
  accounts: [{ id: 'a1', name: 'Checking', type: 'checking', balanceCents: 10000, currency: 'EUR' }],
  transactions: [],
  goals: [],
}

describe('DataTools overview', () => {
  it('shows risk-tiered sections, not equal cards, with English copy', () => {
    render(<DataTools userId="user-1" state={state} onRestore={vi.fn()} onReset={vi.fn()}/>)
    expect(screen.getByRole('heading', { name: 'Data and Backup', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create encrypted backup/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Restore from backup/ })).toBeInTheDocument()
    expect(screen.getByText('Export as CSV (unencrypted)')).toBeInTheDocument()
    expect(screen.getByText('Plaintext')).toBeInTheDocument()
    expect(screen.getAllByText('Reset financial data').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Delete account').length).toBeGreaterThan(0)
    expect(screen.queryByText(/leere|Ausgangsstand|Datensouveränität/)).not.toBeInTheDocument()
  })

  it('navigates into and back out of the vault-password sub-page', async () => {
    const user = userEvent.setup()
    render(<DataTools userId="user-1" state={state} onRestore={vi.fn()} onReset={vi.fn()}/>)
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('heading', { name: 'Change vault password' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Data and Backup/ }))
    expect(screen.getByRole('heading', { name: 'Data and Backup', level: 2 })).toBeInTheDocument()
  })

  it('opens the CSV plaintext warning dialog before exporting, never exporting directly', async () => {
    const user = userEvent.setup()
    render(<DataTools userId="user-1" state={state} onRestore={vi.fn()} onReset={vi.fn()}/>)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    const dialog = screen.getByRole('dialog', { name: "This file won't be encrypted." })
    expect(within(dialog).getByText(/won't be encrypted/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
  })

  it('opens a Finance-Planner-owned reset dialog with corrected, non-empty-claiming copy', async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    render(<DataTools userId="user-1" state={state} onRestore={vi.fn()} onReset={onReset}/>)
    await user.click(screen.getByRole('button', { name: 'Reset financial data' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset financial data?' })
    expect(within(dialog).getByText(/example data, not an empty state/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Kept:/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Reset financial data' }))
    expect(onReset).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent(/example dataset/)
  })

  it('navigates to the account-deletion flow via a typed-phrase page, not a native confirm', async () => {
    const user = userEvent.setup()
    render(<DataTools userId="user-1" state={state} onRestore={vi.fn()} onReset={vi.fn()}/>)
    await user.click(screen.getByRole('button', { name: 'Delete account' }))
    expect(screen.getByRole('heading', { name: 'Delete account' })).toBeInTheDocument()
    expect(screen.getByText('DELETE MY ACCOUNT', { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByText(/to confirm/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue to final confirmation' })).toBeDisabled()
  })
})
