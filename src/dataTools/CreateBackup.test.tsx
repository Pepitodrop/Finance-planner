import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CreateBackup } from './CreateBackup'
import type { AppState } from '../types'

vi.mock('../backup', () => ({ exportBackup: vi.fn() }))
import { exportBackup } from '../backup'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const state: AppState = { accounts: [], transactions: [], goals: [] }

describe('CreateBackup (DATA-02)', () => {
  it('requires at least 12 characters before the create button is enabled', async () => {
    const user = userEvent.setup()
    render(<CreateBackup state={state} onBack={vi.fn()}/>)
    const button = screen.getByRole('button', { name: /create and download backup/i })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/backup password/i), 'short')
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText(/backup password/i), 'word12345')
    expect(button).toBeEnabled()
  })

  it('creates and downloads a backup, distinct from the vault password', async () => {
    vi.mocked(exportBackup).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<CreateBackup state={state} onBack={vi.fn()}/>)
    await user.type(screen.getByLabelText(/backup password/i), 'a-strong-backup-password')
    await user.click(screen.getByRole('button', { name: /create and download backup/i }))
    expect(exportBackup).toHaveBeenCalledWith(state, 'a-strong-backup-password')
    expect(await screen.findByRole('status')).toHaveTextContent('Backup created and downloaded.')
    expect(screen.getByText(/separate from your vault password/i)).toBeInTheDocument()
  })

  it('shows an inline error and keeps the page usable when export fails', async () => {
    vi.mocked(exportBackup).mockRejectedValue(new Error('Encryption failed.'))
    const user = userEvent.setup()
    render(<CreateBackup state={state} onBack={vi.fn()}/>)
    await user.type(screen.getByLabelText(/backup password/i), 'a-strong-backup-password')
    await user.click(screen.getByRole('button', { name: /create and download backup/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Encryption failed.')
  })
})
