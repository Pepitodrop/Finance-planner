import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb(): never {
  throw new Error('secret internal detail that must never reach the DOM')
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders children normally when nothing has crashed', () => {
    render(<ErrorBoundary><p>Dashboard</p></ErrorBoundary>)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('shows a truthful, English fatal-error page without leaking the error message or a stack trace', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><Bomb/></ErrorBoundary>)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveAttribute('lang', 'en')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Finance Planner couldn't continue.")
    expect(screen.getByText(/your locally stored data was not automatically deleted/i)).toBeInTheDocument()
    expect(alert.textContent).not.toContain('secret internal detail')
    expect(document.querySelector('pre')).not.toBeInTheDocument()
  })

  it('offers a reload action', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const user = userEvent.setup()

    render(<ErrorBoundary><Bomb/></ErrorBoundary>)
    await user.click(screen.getByRole('button', { name: 'Reload Finance Planner' }))
    expect(reload).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
