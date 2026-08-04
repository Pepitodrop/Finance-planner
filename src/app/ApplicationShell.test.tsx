import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(within(desktop).getAllByRole('button')).toHaveLength(9)
    expect(within(desktop).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')

    const mobile = screen.getByRole('navigation', { name: 'Mobile primary navigation' })
    expect(screen.getAllByRole('navigation', { name: 'Mobile primary navigation' })).toHaveLength(1)
    expect(within(mobile).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Dashboard', 'Transactions', 'Goals', 'Connections', 'More',
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
      'AI categorisation',
      'Finance assistant',
      'Receipt review',
      'Data and backup',
    ])
    expect(document.querySelector('.app-shell__frame')).toHaveAttribute('inert')
    expect(within(dialog).getByRole('button', { name: 'Close more destinations' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'More destinations' })).not.toBeInTheDocument()
    expect(more).toHaveFocus()
    expect(document.querySelector('.app-shell__frame')).not.toHaveAttribute('inert')
  })

  it('navigates from More and moves focus to the main content', async () => {
    const user = userEvent.setup()
    render(<TestShell />)
    await user.click(within(screen.getByRole('navigation', { name: 'Mobile primary navigation' })).getByRole('button', { name: 'More' }))
    await user.click(within(screen.getByRole('dialog', { name: 'More destinations' })).getByRole('button', { name: 'Recurring payments' }))
    expect(screen.getByRole('heading', { name: 'recurring' })).toBeInTheDocument()
    expect(document.getElementById('main-content')).toHaveFocus()
  })
})
