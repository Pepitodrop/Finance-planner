import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountPage } from './AccountPage'
import type { AuthUser } from './AuthGate'

afterEach(cleanup)

const USER: AuthUser = { id: 'google:1', email: 'demo@finance-planner.test', name: 'Demo User', passkeyCount: 2 }

describe('AccountPage (ACCOUNT-01)', () => {
  it('shows identity, passkey count, and the vault-security link, with no profile editor', () => {
    render(<AccountPage user={USER} onLogout={vi.fn()} onNavigateToData={vi.fn()}/>)
    expect(screen.getByText('Demo User')).toBeInTheDocument()
    expect(screen.getByText('demo@finance-planner.test')).toBeInTheDocument()
    expect(screen.getByText('2 passkeys registered for sign-in.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /name/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /email/i })).not.toBeInTheDocument()
  })

  it('shows singular copy for exactly one passkey and the no-passkeys copy for zero', () => {
    const { rerender } = render(<AccountPage user={{ ...USER, passkeyCount: 1 }} onLogout={vi.fn()} onNavigateToData={vi.fn()}/>)
    expect(screen.getByText('1 passkey registered for sign-in.')).toBeInTheDocument()
    rerender(<AccountPage user={{ ...USER, passkeyCount: 0 }} onLogout={vi.fn()} onNavigateToData={vi.fn()}/>)
    expect(screen.getByText('No passkeys registered yet.')).toBeInTheDocument()
  })

  it('navigates to Data & Backup via the vault-security link', async () => {
    const user = userEvent.setup()
    const onNavigateToData = vi.fn()
    render(<AccountPage user={USER} onLogout={vi.fn()} onNavigateToData={onNavigateToData}/>)
    await user.click(screen.getByRole('button', { name: /manage vault security in data/i }))
    expect(onNavigateToData).toHaveBeenCalledOnce()
  })

  it('signs out on button click using a plain secondary button, never a destructive style', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn().mockResolvedValue(undefined)
    render(<AccountPage user={USER} onLogout={onLogout} onNavigateToData={vi.fn()}/>)
    const button = screen.getByRole('button', { name: /sign out/i })
    expect(button).toHaveClass('secondary')
    expect(button).not.toHaveClass('danger-action')
    await user.click(button)
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('shows an inline error and keeps the button enabled again when sign-out fails, without claiming other devices are affected', async () => {
    const user = userEvent.setup()
    const onLogout = vi.fn().mockRejectedValue(new Error('network down'))
    render(<AccountPage user={USER} onLogout={onLogout} onNavigateToData={vi.fn()}/>)
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign out. Check your connection and try again.")
    expect(screen.getByRole('button', { name: /sign out/i })).not.toBeDisabled()
    expect(screen.queryByText(/everywhere|all devices/i)).not.toBeInTheDocument()
  })

  it('never implies signing out affects the encrypted vault or other devices', () => {
    render(<AccountPage user={USER} onLogout={vi.fn()} onNavigateToData={vi.fn()}/>)
    expect(screen.queryByText(/everywhere|all devices|deletes your vault|clears your vault/i)).not.toBeInTheDocument()
    expect(screen.getByText(/separate from your encrypted vault/i)).toBeInTheDocument()
  })
})
