import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from './types'

// App.tsx's removeAccount() orchestrates the coordinated remove flow
// (BLOCKER 2, independent review, 2026-08-27): for a provider-linked
// account, the durable server-side exclusion MUST succeed before local
// AppState changes at all -- never fire-and-forget. These tests exercise
// the REAL implementation (not a mock of onRemoveAccount, unlike
// Dashboard.test.tsx's dialog-behavior tests), so only storage and the
// network-facing connectors.ts calls are mocked.
vi.mock('./storage', () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
  resetStoredState: vi.fn(),
}))

vi.mock('./connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./connectors')>()
  return {
    ...actual,
    excludeProviderAccount: vi.fn(async () => undefined),
  }
})

import { excludeProviderAccount } from './connectors'
import { loadState } from './storage'
import App from './App'

const manualState: AppState = {
  accounts: [{ id: 'manual-account', name: 'Bargeld', type: 'cash', balanceCents: 10_000, currency: 'EUR' }],
  transactions: [],
  goals: [],
}

const providerStateWithStableId: AppState = {
  accounts: [{ id: 'connector:enablebanking:acct-1', externalId: 'acct-1', stableId: 'a'.repeat(64), name: 'Girokonto', type: 'checking', balanceCents: 50_000, currency: 'EUR' }],
  transactions: [],
  goals: [],
}

function renderApp(initialState: AppState) {
  vi.mocked(loadState).mockReturnValue(initialState)
  const onLogout = vi.fn(async () => {})
  render(<App userId="user-1" userName="Alex Rivera" user={{ id: 'user-1', email: 'alex@example.test', name: 'Alex Rivera', passkeyCount: 0 }} onLogout={onLogout}/>)
}

describe('App: coordinated provider-account removal (BLOCKER 2)', () => {
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  it('persists the durable exclusion BEFORE removing the account locally, and only removes it after that call resolves', async () => {
    let resolveExclusion!: () => void
    vi.mocked(excludeProviderAccount).mockImplementation(() => new Promise((resolve) => { resolveExclusion = () => resolve(undefined) }))
    renderApp(providerStateWithStableId)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Actions for Girokonto' }))
    await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
    await user.click(screen.getByRole('button', { name: 'Remove account' }))

    // Still in flight: excludeProviderAccount was called, but the account
    // must still be visible -- local removal has not happened yet.
    expect(excludeProviderAccount).toHaveBeenCalledWith('enablebanking', 'a'.repeat(64), 'Girokonto')
    expect(screen.getByText('Girokonto')).toBeInTheDocument()

    resolveExclusion()
    await waitFor(() => expect(screen.queryByText('Girokonto')).not.toBeInTheDocument())
    expect(screen.getByText('No accounts recorded')).toBeInTheDocument()
  })

  it('on exclusion failure, keeps the account visible and never removes it locally', async () => {
    vi.mocked(excludeProviderAccount).mockRejectedValueOnce(new Error('network error'))
    renderApp(providerStateWithStableId)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Actions for Girokonto' }))
    await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
    await user.click(screen.getByRole('button', { name: 'Remove account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('network error')
    expect(screen.getByText('Girokonto')).toBeInTheDocument()
  })

  it('a provider account with no stableId is never removed and excludeProviderAccount is never called', async () => {
    const noStableId: AppState = {
      accounts: [{ id: 'connector:enablebanking:acct-2', externalId: 'acct-2', name: 'Sparkonto', type: 'savings', balanceCents: 5_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    renderApp(noStableId)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Actions for Sparkonto' }))
    await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
    expect(screen.queryByRole('button', { name: 'Remove account' })).not.toBeInTheDocument()
    expect(excludeProviderAccount).not.toHaveBeenCalled()
    expect(screen.getByText('Sparkonto')).toBeInTheDocument()
  })

  it('a manual account is removed synchronously, without ever calling excludeProviderAccount, and offers Undo', async () => {
    renderApp(manualState)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
    await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
    await user.click(screen.getByRole('button', { name: 'Remove account' }))

    expect(excludeProviderAccount).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Bargeld')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Undo/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(screen.getByText('Bargeld')).toBeInTheDocument()
  })
})
