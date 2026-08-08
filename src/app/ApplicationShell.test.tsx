import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { ApplicationShell } from './ApplicationShell'
import type { DestinationId } from './navigation'
import { MobileExperience } from '../MobileExperience'

function TestShell() {
  const [destination, setDestination] = useState<DestinationId>('dashboard')
  return <ApplicationShell activeDestination={destination} onNavigate={setDestination}>
    <h1>{destination}</h1>
  </ApplicationShell>
}

describe('ApplicationShell navigation', () => {
  afterEach(cleanup)

  it('renders one desktop model and the staged mobile destinations', () => {
    render(<><MobileExperience/><TestShell /></>)
    const desktop = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(desktop).getAllByRole('button')).toHaveLength(12)
    expect(within(desktop).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

    const mobile = screen.getByRole('navigation', { name: 'Mobile primary navigation' })
    expect(screen.getAllByRole('navigation', { name: 'Mobile primary navigation' })).toHaveLength(1)
    expect(within(mobile).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Dashboard', 'Transactions', 'Accounts', 'Goals', 'More',
    ])
  })

  it('switches destinations and exposes active-state semantics', async () => {
    const user = userEvent.setup()
    render(<TestShell />)
    const desktop = screen.getByRole('navigation', { name: 'Primary navigation' })
    await user.click(within(desktop).getByRole('button', { name: 'Transactions' }))
    expect(screen.getByRole('heading', { name: 'transactions' })).toBeInTheDocument()
    expect(within(desktop).getByRole('button', { name: 'Transactions' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens More, lists secondary destinations, and restores focus after Escape', async () => {
    const user = userEvent.setup()
    render(<TestShell />)
    const more = within(screen.getByRole('navigation', { name: 'Mobile primary navigation' })).getByRole('button', { name: 'More' })
    more.focus()
    await user.click(more)

    const dialog = screen.getByRole('dialog', { name: 'More destinations' })
    expect(within(dialog).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Close more destinations',
      'Recurring payments',
      'Bank and PayPal connections',
      'Provider subscriptions',
      'Finance intelligence',
      'Finance assistant',
      'Receipt review',
      'Data and backup',
      'Account and session',
    ])
    expect([...dialog.querySelectorAll('.app-more-sheet__group-label')].map((el) => el.textContent)).toEqual([
      'Planning', 'Connections', 'Intelligence', 'Data & account',
    ])
    expect(document.querySelector('.app-shell__frame')).toHaveAttribute('inert')
    expect(within(dialog).getByRole('button', { name: 'Close more destinations' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'More destinations' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
    expect(document.querySelector('.app-shell__frame')).not.toHaveAttribute('inert')
    expect(screen.getByRole('navigation', { name: 'Mobile primary navigation' })).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
  })

  it('navigates from More and moves focus to the main content', async () => {
    const user = userEvent.setup()
    render(<TestShell />)
    await user.click(within(screen.getByRole('navigation', { name: 'Mobile primary navigation' })).getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More destinations' })).getByRole('button', { name: 'Recurring payments' }))
    expect(screen.getByRole('heading', { name: 'recurring' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'More destinations' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.getElementById('main-content')).toHaveFocus())
    expect(document.querySelector('.app-shell__frame')).not.toHaveAttribute('inert')
    expect(screen.getByRole('navigation', { name: 'Mobile primary navigation' })).not.toHaveAttribute('inert')
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps vault locking in the shell and exposes it through More on mobile', async () => {
    const user = userEvent.setup()
    const onLockVault = vi.fn()
    render(<ApplicationShell activeDestination="dashboard" onNavigate={vi.fn()} onLockVault={onLockVault}><h1>dashboard</h1></ApplicationShell>)
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: 'Lock encrypted finance vault' })).toBeInTheDocument()

    await user.click(within(screen.getByRole('navigation', { name: 'Mobile primary navigation' })).getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More destinations' })).getByRole('button', { name: 'Lock encrypted finance vault' }))
    expect(onLockVault).toHaveBeenCalledOnce()
  })
})
