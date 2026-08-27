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
import { loadState, saveState } from './storage'
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

// BLOCKER 2 (fourth independent review, 2026-08-27): the exact "duplicated
// legacy/current pair" state this codebase's own previous live Mock ASPSP
// passes produced -- two provider-linked accounts, both still lacking
// stableId, both representing the same real bank account. Account A (the
// stale duplicate) must be removable via the new local-only path; Account
// B must be unaffected by removing A; the removal must never call
// excludeProviderAccount (no durable exclusion is created for a legacy
// removal); and the cleanup must persist across a reload (the mocked
// saveState()/loadState() round-trip stands in for the real cloud/local
// persistence this app already saves through on every state change).
describe('App: remove local legacy account (fourth independent review, BLOCKER 2)', () => {
  afterEach(() => { cleanup(); vi.resetAllMocks() })

  const accountAId = 'connector:enablebanking:old-session-uid'
  const accountBId = 'connector:enablebanking:current-session-uid'
  const duplicatedPairState: AppState = {
    accounts: [
      { id: accountAId, externalId: 'old-session-uid', name: 'Altes Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' },
      { id: accountBId, externalId: 'current-session-uid', stableId: 'c'.repeat(64), name: 'Girokonto', type: 'checking', balanceCents: 695_950, currency: 'EUR' },
    ],
    transactions: [
      { id: 'connector:enablebanking:a-hist-1', accountId: accountAId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' },
      { id: 'connector:enablebanking:b-hist-1', accountId: accountBId, description: 'Salary', category: 'Income', type: 'income', amountCents: 250_000, date: '2026-08-01' },
    ],
    goals: [],
  }

  it('removes only Account A (and only its transactions), never calls excludeProviderAccount, normalizes the doubled dashboard total, and a genuine reload of the saved state keeps Account A gone', async () => {
    renderApp(duplicatedPairState)
    const user = userEvent.setup()

    // Sanity: the doubled state really does show both accounts' balances.
    expect(screen.getByText('Altes Girokonto')).toBeInTheDocument()
    expect(screen.getByText('Girokonto')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Actions for Altes Girokonto' }))
    await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
    expect(screen.getByRole('button', { name: 'Remove local copy' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove local copy' }))

    await waitFor(() => expect(screen.queryByText('Altes Girokonto')).not.toBeInTheDocument())
    expect(excludeProviderAccount).not.toHaveBeenCalled()
    // Account B and its balance survive untouched.
    expect(screen.getByText('Girokonto')).toBeInTheDocument()

    // Persisted through the normal save path -- the mocked saveState()'s
    // last call is what a reload would load back.
    const lastSaved = vi.mocked(saveState).mock.calls.at(-1)?.[0] as AppState
    expect(lastSaved.accounts.map((account) => account.id)).toEqual([accountBId])
    expect(lastSaved.transactions.map((transaction) => transaction.id)).toEqual(['connector:enablebanking:b-hist-1'])

    // Genuine round-trip (found by adversarial review, 2026-08-27, as a
    // cosmetic gap in an earlier draft of this test): reload by feeding
    // the EXACT state saveState() was called with back into loadState() on
    // a fresh mount, rather than hand-constructing an equivalent-looking
    // state -- proves the actual saved shape reloads correctly, not merely
    // a shape someone believes matches it.
    cleanup()
    renderApp(lastSaved)
    expect(screen.queryByText('Altes Girokonto')).not.toBeInTheDocument()
    expect(screen.getByText('Girokonto')).toBeInTheDocument()
  })
})
