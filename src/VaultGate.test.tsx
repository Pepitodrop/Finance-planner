import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VaultGate } from './VaultGate'
import { emptyProductionState } from './data'
import { loadState } from './storage'
import type { AppState } from './types'
import { createVault } from './vault'

let userCounter = 0
function freshUserId() {
  userCounter += 1
  return `vault-test-user-${userCounter}`
}

function legacyDemoState(): AppState {
  return {
    accounts: [
      { id: 'account-checking', name: 'Girokonto', type: 'checking', balanceCents: 286450, currency: 'EUR' },
      { id: 'account-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 420000, currency: 'EUR' },
      { id: 'account-cash', name: 'Bargeld', type: 'cash', balanceCents: 8500, currency: 'EUR' },
    ],
    transactions: [
      { id: 't1', accountId: 'account-checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 185000, date: '2026-07-01', recurring: true },
      { id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
      { id: 't3', accountId: 'account-checking', description: 'Supermarkt', category: 'Lebensmittel', type: 'expense', amountCents: 6840, date: '2026-07-08' },
      { id: 't4', accountId: 'account-checking', description: 'Fitnessstudio', category: 'Verträge', type: 'expense', amountCents: 2990, date: '2026-07-10', recurring: true },
      { id: 't5', accountId: 'account-checking', description: 'Deutschlandticket', category: 'Mobilität', type: 'expense', amountCents: 5800, date: '2026-07-12', recurring: true },
      { id: 't6', accountId: 'account-checking', description: 'Werkstudentenjob', category: 'Einkommen', type: 'income', amountCents: 62000, date: '2026-07-15', recurring: true },
      { id: 't7', accountId: 'account-checking', description: 'Restaurant', category: 'Freizeit', type: 'expense', amountCents: 4200, date: '2026-07-18' },
    ],
    goals: [
      { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
      { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
    ],
  }
}

function fillAndSubmit(password: string, confirmation?: string) {
  fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: password } })
  if (confirmation !== undefined) fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirmation } })
  fireEvent.click(screen.getByRole('button', { name: /turn on encryption|unlock/i }))
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('VaultGate: first-device setup (VAULT-01)', () => {
  it('rejects a password under 12 characters and a mismatched confirmation', async () => {
    render(<VaultGate userId={freshUserId()}>{() => <div>App content</div>}</VaultGate>)
    fillAndSubmit('short', 'short')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/at least 12 characters/i))

    fillAndSubmit('longenoughpassword1', 'longenoughpassword2')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i))
  })

  it('never shows a password recovery link', () => {
    render(<VaultGate userId={freshUserId()}>{() => <div>App content</div>}</VaultGate>)
    expect(screen.queryByText(/forgot|reset your (vault )?password/i)).not.toBeInTheDocument()
    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument()
  })

  it('distinguishes vault encryption from account sign-in in its own copy', () => {
    render(<VaultGate userId={freshUserId()}>{() => <div>App content</div>}</VaultGate>)
    expect(screen.getByText(/separate from signing in/i)).toBeInTheDocument()
  })

  it('exposes setup as a modal dialog so optional prompts (e.g. the passkey-enrolment banner) stay suppressed behind it instead of overlapping the submit button', () => {
    render(<VaultGate userId={freshUserId()}>{() => <div>App content</div>}</VaultGate>)
    expect(screen.getByRole('dialog', { name: 'Set up your encrypted vault' })).toHaveAttribute('aria-modal', 'true')
  })

  it('CRITICAL: a genuinely new account (no legacy data) starts from an honest empty state, not seeded demo finances', async () => {
    const userId = freshUserId()
    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    expect(screen.queryByText(/data stored locally from before encryption/i)).not.toBeInTheDocument()

    fillAndSubmit('a-genuinely-new-password', 'a-genuinely-new-password')
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())

    const resulting = loadState()
    expect(resulting).toEqual(emptyProductionState)
    expect(resulting.accounts).toHaveLength(0)
    expect(resulting.transactions).toHaveLength(0)
  })

  it('preserves real legacy local data instead of discarding it during migration', async () => {
    const userId = freshUserId()
    const legacyState = { accounts: [{ id: 'a1', name: 'Legacy checking', type: 'checking' as const, balanceCents: 12345, currency: 'EUR' as const }], transactions: [], goals: [] }
    localStorage.setItem('finance-planner-state-v2', JSON.stringify(legacyState))

    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    expect(screen.getByText(/data stored locally from before encryption/i)).toBeInTheDocument()

    fillAndSubmit('a-migration-password-1', 'a-migration-password-1')
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())

    expect(loadState()).toEqual(legacyState)
    expect(localStorage.getItem('finance-planner-state-v2')).toBeNull()
  })
})

describe('VaultGate: unlock (VAULT-02)', () => {
  it('unlocks an existing vault and shows a decrypting/syncing loading state, with no reset link', async () => {
    const userId = freshUserId()
    await createVault('an-existing-vault-password', emptyProductionState, userId)

    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    expect(screen.getByRole('heading', { name: 'Unlock Finance Planner' })).toBeInTheDocument()
    expect(screen.getByText(/stays on this device/i)).toBeInTheDocument()
    expect(screen.queryByLabelText('Confirm password')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Unlock Finance Planner' })).toHaveAttribute('aria-modal', 'true')

    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'an-existing-vault-password' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())
  })

  it('clears an untouched legacy sample vault after decryption instead of showing seeded finances', async () => {
    const userId = freshUserId()
    await createVault('legacy-demo-password', legacyDemoState(), userId)

    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    fillAndSubmit('legacy-demo-password')
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())

    expect(loadState()).toEqual(emptyProductionState)
  })

  it('never clears a legacy-looking vault once a real user transaction has been added', async () => {
    const userId = freshUserId()
    const modified = legacyDemoState()
    modified.transactions.push({ id: '52a54403-3c89-4a9e-b721-29670ebd66df', accountId: 'account-checking', description: 'My real purchase', category: 'Other', type: 'expense', amountCents: 1234, date: '2026-08-09' })
    await createVault('modified-demo-password', modified, userId)

    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    fillAndSubmit('modified-demo-password')
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())

    expect(loadState()).toEqual(modified)
  })

  it('never clears a legacy-looking vault when an existing tN transaction was edited', async () => {
    const userId = freshUserId()
    const modified = legacyDemoState()
    modified.transactions[0].amountCents += 1
    await createVault('edited-demo-password', modified, userId)

    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    fillAndSubmit('edited-demo-password')
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())

    expect(loadState()).toEqual(modified)
  })

  it('shows a clear error and stays on the unlock screen for a wrong password', async () => {
    const userId = freshUserId()
    await createVault('the-correct-password', emptyProductionState, userId)

    render(<VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>)
    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'a-wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect password/i))
    expect(screen.getByRole('heading', { name: 'Unlock Finance Planner' })).toBeInTheDocument()
  })
})

describe('VaultGate: data conflict (VAULT-04)', () => {
  it('presents the real conflict fixture as a full dialog with two equal, exact choices, no window.confirm', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    const userId = freshUserId()
    await createVault('an-existing-vault-password', emptyProductionState, userId)
    const confirmSpy = vi.spyOn(window, 'confirm')

    render(<div>
      <main id="main-content"><button type="button">Outside</button></main>
      <VaultGate userId={userId}>{() => <div>App content</div>}</VaultGate>
    </div>)

    fireEvent.change(screen.getByLabelText('Vault password'), { target: { value: 'an-existing-vault-password' } })
    fireEvent.click(screen.getByRole('button', { name: /unlock/i }))
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())

    const acceptance = (window as unknown as { __financePlannerVaultAcceptanceState: (mode: string) => void }).__financePlannerVaultAcceptanceState
    expect(acceptance).toBeTypeOf('function')
    acceptance('conflict')

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Two versions of your data exist' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /use the cloud version/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /keep this device's version/i })).toBeInTheDocument()
    expect(screen.queryByText(/merge/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/archived/i)).not.toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
