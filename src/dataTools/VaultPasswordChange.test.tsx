import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VaultPasswordChange } from './VaultPasswordChange'

vi.mock('../vault', () => ({ changeVaultPassword: vi.fn() }))
import { changeVaultPassword } from '../vault'

afterEach(() => { cleanup(); vi.clearAllMocks() })

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, current: string, next: string, confirm: string) {
  await user.type(screen.getByLabelText('Current vault password'), current)
  await user.type(screen.getByLabelText(/^new vault password/i), next)
  await user.type(screen.getByLabelText(/^confirm new vault password/i), confirm)
  await user.click(screen.getByRole('button', { name: /change vault password/i }))
}

describe('VaultPasswordChange (DATA-06)', () => {
  it('re-encrypts on success and never touches the account sign-in', async () => {
    vi.mocked(changeVaultPassword).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<VaultPasswordChange onBack={vi.fn()}/>)
    await fillAndSubmit(user, 'old-vault-password', 'new-vault-password-12', 'new-vault-password-12')
    expect(changeVaultPassword).toHaveBeenCalledWith('old-vault-password', 'new-vault-password-12')
    expect(await screen.findByRole('status')).toHaveTextContent('re-encrypted with a new key')
    expect(screen.getByText(/separate from signing in to your account/i)).toBeInTheDocument()
  })

  it('shows a field-level error for a wrong current password, distinct from a mismatch', async () => {
    vi.mocked(changeVaultPassword).mockRejectedValue(new Error('The current vault password is incorrect.'))
    const user = userEvent.setup()
    render(<VaultPasswordChange onBack={vi.fn()}/>)
    await fillAndSubmit(user, 'wrong-password', 'new-vault-password-12', 'new-vault-password-12')
    expect(await screen.findByRole('alert')).toHaveTextContent("That's not your current vault password.")
  })

  it('rejects a mismatched confirmation before calling changeVaultPassword at all', async () => {
    const user = userEvent.setup()
    render(<VaultPasswordChange onBack={vi.fn()}/>)
    await fillAndSubmit(user, 'old-vault-password', 'new-vault-password-12', 'different-password-12')
    expect(screen.getByRole('alert')).toHaveTextContent("Doesn't match your new password.")
    expect(changeVaultPassword).not.toHaveBeenCalled()
  })
})
