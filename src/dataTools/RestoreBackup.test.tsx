import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RestoreBackup } from './RestoreBackup'
import type { AppState } from '../types'

vi.mock('../backup', () => ({ importBackup: vi.fn() }))
import { importBackup } from '../backup'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const RESTORED_STATE: AppState = { accounts: [{ id: 'a1', name: 'Checking', type: 'checking', balanceCents: 500, currency: 'EUR' }], transactions: [], goals: [] }

function pickFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
}

describe('RestoreBackup (DATA-03/04)', () => {
  it('validates the file and password entirely before ever calling onRestore', async () => {
    vi.mocked(importBackup).mockResolvedValue(RESTORED_STATE)
    const user = userEvent.setup()
    const onRestore = vi.fn()
    render(<RestoreBackup onRestore={onRestore} onBack={vi.fn()}/>)
    expect(screen.getByRole('button', { name: /restore backup/i })).toBeDisabled()

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    pickFile(input, new File(['x'], 'my-backup.fpbackup'))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(screen.getByRole('button', { name: /restore backup/i })).toBeDisabled()

    await user.type(screen.getByLabelText(/backup password/i), 'correct-password')
    await user.click(screen.getByRole('button', { name: /restore backup/i }))
    expect(importBackup).toHaveBeenCalledWith(expect.any(File), 'correct-password')
    expect(onRestore).toHaveBeenCalledWith(RESTORED_STATE)
    expect(await screen.findByRole('status')).toHaveTextContent('Backup restored.')
  })

  it('shows a combined honest error for wrong password or corruption, and leaves the device unchanged', async () => {
    vi.mocked(importBackup).mockRejectedValue(new Error('Wrong password, or the backup file is corrupted.'))
    const user = userEvent.setup()
    const onRestore = vi.fn()
    render(<RestoreBackup onRestore={onRestore} onBack={vi.fn()}/>)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    pickFile(input, new File(['x'], 'my-backup.fpbackup'))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await user.type(screen.getByLabelText(/backup password/i), 'wrong-password')
    await user.click(screen.getByRole('button', { name: /restore backup/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Wrong password, or the backup file is corrupted.")
    expect(alert).toHaveTextContent('Nothing on this device has changed.')
    expect(onRestore).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose another file' })).toBeInTheDocument()
  })

  it('renders the deterministic failure fixture without touching importBackup', () => {
    render(<RestoreBackup onRestore={vi.fn()} onBack={vi.fn()} acceptanceShowFailure/>)
    expect(screen.getByRole('alert')).toHaveTextContent('Wrong password, or the backup file is corrupted.')
    expect(importBackup).not.toHaveBeenCalled()
  })
})
