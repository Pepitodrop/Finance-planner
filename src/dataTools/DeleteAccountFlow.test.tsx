import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_DELETE_CONFIRMATION, DeleteAccountFlow } from './DeleteAccountFlow'

vi.mock('../vault', () => ({ removeEncryptedVault: vi.fn() }))
vi.mock('../storage', () => ({ clearUnlockedState: vi.fn() }))
import { clearUnlockedState } from '../storage'
import { removeEncryptedVault } from '../vault'

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)
}

describe('DeleteAccountFlow (DATA-09/10/11)', () => {
  it('gates the continue button on the exact typed phrase, not a native confirm', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountFlow userId="user-1" onBack={vi.fn()} onCreateBackup={vi.fn()}/>)
    const button = screen.getByRole('button', { name: 'Continue to final confirmation' })
    expect(button).toBeDisabled()
    await user.type(screen.getByRole('textbox'), 'delete my account')
    expect(button).toBeDisabled()
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), ACCOUNT_DELETE_CONFIRMATION)
    expect(button).toBeEnabled()
  })

  it('runs local cleanup and redirects only after the server confirms deletion', async () => {
    const fetchMock = vi.fn().mockReturnValue(jsonResponse({ deleted: true }))
    vi.stubGlobal('fetch', fetchMock)
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign: assignSpy }, writable: true })
    const user = userEvent.setup()
    render(<DeleteAccountFlow userId="user-1" onBack={vi.fn()} onCreateBackup={vi.fn()}/>)
    await user.type(screen.getByRole('textbox'), ACCOUNT_DELETE_CONFIRMATION)
    await user.click(screen.getByRole('button', { name: 'Continue to final confirmation' }))

    const dialog = screen.getByRole('alertdialog', { name: 'Permanently delete your account?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/account', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ confirmation: ACCOUNT_DELETE_CONFIRMATION }),
    }))
    await vi.waitFor(() => expect(removeEncryptedVault).toHaveBeenCalledWith('user-1'))
    expect(clearUnlockedState).toHaveBeenCalledOnce()
    expect(assignSpy).toHaveBeenCalledWith('/')
  })

  it('shows the failure dialog and never removes local data when the server call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(jsonResponse({ error: 'Server unavailable.' }, false)))
    const user = userEvent.setup()
    render(<DeleteAccountFlow userId="user-1" onBack={vi.fn()} onCreateBackup={vi.fn()}/>)
    await user.type(screen.getByRole('textbox'), ACCOUNT_DELETE_CONFIRMATION)
    await user.click(screen.getByRole('button', { name: 'Continue to final confirmation' }))
    const confirmDialog = screen.getByRole('alertdialog', { name: 'Permanently delete your account?' })
    await user.click(within(confirmDialog).getByRole('button', { name: 'Delete account' }))

    const failureDialog = await screen.findByRole('dialog', { name: "Account deletion didn't complete." })
    expect(within(failureDialog).getByText(/still here — nothing was removed/)).toBeInTheDocument()
    expect(within(failureDialog).getByText('Server unavailable.')).toBeInTheDocument()
    expect(removeEncryptedVault).not.toHaveBeenCalled()
    expect(clearUnlockedState).not.toHaveBeenCalled()
  })

  it('offers a backup link before the point of no return, without stealing focus from the typed-phrase field', () => {
    const onCreateBackup = vi.fn()
    render(<DeleteAccountFlow userId="user-1" onBack={vi.fn()} onCreateBackup={onCreateBackup}/>)
    expect(screen.getByRole('button', { name: /consider creating an encrypted backup first/i })).toBeInTheDocument()
  })
})
