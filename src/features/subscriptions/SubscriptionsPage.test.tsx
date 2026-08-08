import { useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../../types'
import { SubscriptionsPage } from './SubscriptionsPage'

vi.mock('../../googleSubscriptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../googleSubscriptions')>()
  return {
    ...actual,
    syncGoogleSubscriptions: vi.fn(),
    startGoogleSubscriptionConnection: vi.fn(async () => {}),
    disconnectGoogleSubscriptions: vi.fn(),
  }
})

import { disconnectGoogleSubscriptions, startGoogleSubscriptionConnection, syncGoogleSubscriptions } from '../../googleSubscriptions'

const baseState: AppState = { accounts: [], transactions: [], goals: [] }

// SubscriptionsPage reads its rendered list from props.state (the shared
// AppState) rather than local component state, so it round-trips through
// onApply the same way App.tsx's real setState loop does -- this harness
// mirrors that instead of using a no-op onApply spy that would leave the
// rendered list permanently empty.
function Harness({ initialState, onApplySpy }: { initialState: AppState; onApplySpy: (state: AppState) => void }) {
  const [state, setState] = useState(initialState)
  return <SubscriptionsPage state={state} onApply={(next) => { onApplySpy(next); setState(next) }}/>
}

function renderSubscriptions(state: AppState = baseState) {
  const onApply = vi.fn()
  const utils = render(<Harness initialState={state} onApplySpy={onApply}/>)
  return { ...utils, onApply }
}

afterEach(() => { cleanup(); vi.clearAllMocks() })
beforeEach(() => { vi.mocked(syncGoogleSubscriptions).mockReset() })

describe('SUB-01: not connected', () => {
  it('shows the honest scope explanation and starts the preflight, not a direct redirect', async () => {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({ connected: false, subscriptions: [], unavailableReason: 'not_connected' })
    const user = userEvent.setup()
    renderSubscriptions()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connect a provider to import subscriptions' })).toBeInTheDocument())
    expect(screen.getByText(/different from Recurring Payments/)).toBeInTheDocument()
    expect(screen.getByText(/doesn't read your email, files, or Google Drive/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /continue to google/i }))
    expect(screen.getByRole('heading', { name: "You're about to leave Finance Planner" })).toBeInTheDocument()
    expect(startGoogleSubscriptionConnection).not.toHaveBeenCalled()
  })
})

describe('SUB-02: preflight', () => {
  it('fires the real redirect only from the preflight screen, and Cancel returns without starting anything', async () => {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({ connected: false, subscriptions: [], unavailableReason: 'not_connected' })
    const user = userEvent.setup()
    renderSubscriptions()
    await waitFor(() => screen.getByRole('button', { name: /continue to google/i }))
    await user.click(screen.getByRole('button', { name: /continue to google/i }))

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('heading', { name: 'Connect a provider to import subscriptions' })).toBeInTheDocument()
    expect(startGoogleSubscriptionConnection).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /continue to google/i }))
    await user.click(screen.getByRole('button', { name: /continue to google/i }))
    expect(startGoogleSubscriptionConnection).toHaveBeenCalledOnce()
  })
})

describe('SUB-03: connected with subscriptions', () => {
  it('renders imported subscriptions with a source badge, status pill, and honest next-charge phrasing, and reconciles into AppState', async () => {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({
      connected: true,
      lastSyncAt: '2026-08-07T09:00:00.000Z',
      subscriptions: [{ externalId: 'yt', provider: 'Google', product: 'YouTube Premium', amountCents: 1199, currency: 'EUR', billingInterval: 'monthly', nextChargeDate: '2026-09-12', status: 'active' }],
    })
    const { onApply } = renderSubscriptions()
    await waitFor(() => expect(screen.getByText('YouTube Premium')).toBeInTheDocument())
    expect(screen.getByText('Synced from Google')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/Next charge:/)).toBeInTheDocument()
    expect(screen.getByText('These are billing records from your connected Google account, not bank transactions.')).toBeInTheDocument()
    expect(screen.queryByText(/you'll be charged/i)).not.toBeInTheDocument()

    expect(onApply).toHaveBeenCalled()
    const applied = onApply.mock.calls.at(-1)![0] as AppState
    expect(applied.subscriptions).toHaveLength(1)
    expect(applied.subscriptions![0]).toMatchObject({ source: 'google', product: 'YouTube Premium' })
  })

  it('never renders a per-row cancel or manage control', async () => {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({
      connected: true,
      lastSyncAt: '2026-08-07T09:00:00.000Z',
      subscriptions: [{ externalId: 'yt', provider: 'Google', product: 'YouTube Premium', amountCents: 1199, currency: 'EUR', billingInterval: 'monthly', status: 'active' }],
    })
    renderSubscriptions()
    await waitFor(() => screen.getByText('YouTube Premium'))
    expect(screen.queryByRole('button', { name: /cancel subscription/i })).not.toBeInTheDocument()
  })
})

describe('SUB-05: connected, nothing to import', () => {
  it('shows a calm empty state, not an error region', async () => {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({ connected: true, lastSyncAt: '2026-08-07T09:00:00.000Z', subscriptions: [] })
    renderSubscriptions()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'No subscriptions found' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync again' })).toBeInTheDocument()
  })
})

describe('SUB-06: unavailable and sync error branches', () => {
  it('shows the capability-unavailable copy without blaming the user, and no manage link since nothing is connected', async () => {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({ connected: false, subscriptions: [], unavailableReason: 'disabled' })
    renderSubscriptions()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/aren't available right now/))
    expect(screen.getByRole('alert')).toHaveTextContent(/isn't something wrong with your account/)
    expect(screen.queryByText(/manage connection/i)).not.toBeInTheDocument()
  })

  it('preserves the last-known subscription list when a later sync fails', async () => {
    vi.mocked(syncGoogleSubscriptions)
      .mockResolvedValueOnce({ connected: true, lastSyncAt: '2026-08-07T09:00:00.000Z', subscriptions: [{ externalId: 'yt', provider: 'Google', product: 'YouTube Premium', amountCents: 1199, currency: 'EUR', billingInterval: 'monthly', status: 'active' }] })
      .mockRejectedValueOnce(new Error('Network error'))
    const user = userEvent.setup()
    renderSubscriptions()
    await waitFor(() => screen.getByText('YouTube Premium'))
    await user.click(screen.getByRole('button', { name: /sync now/i }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't sync your subscriptions/))
    expect(screen.getByRole('alert')).toHaveTextContent(/still shown below/)
    expect(screen.getByText('YouTube Premium')).toBeInTheDocument()
  })
})

describe('SUB-07: manage connection', () => {
  function mockConnected() {
    vi.mocked(syncGoogleSubscriptions).mockResolvedValue({
      connected: true,
      lastSyncAt: '2026-08-07T09:00:00.000Z',
      subscriptions: [{ externalId: 'yt', provider: 'Google', product: 'YouTube Premium', amountCents: 1199, currency: 'EUR', billingInterval: 'monthly', status: 'active' }],
    })
  }

  it('presents two equally-visible disconnect choices, never a single destructive toggle', async () => {
    mockConnected()
    const user = userEvent.setup()
    renderSubscriptions()
    await waitFor(() => screen.getByText('YouTube Premium'))
    await user.click(screen.getByRole('button', { name: /manage connection/i }))
    expect(screen.getByRole('heading', { name: 'Disconnect, keep imported data' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Disconnect and remove imported data' })).toBeInTheDocument()
    expect(screen.getByText(/Recurring Payments detected from your own transactions are never affected/)).toBeInTheDocument()
  })

  it('keep-data option disconnects without touching AppState.subscriptions, behind a confirmation dialog', async () => {
    mockConnected()
    vi.mocked(disconnectGoogleSubscriptions).mockResolvedValue({ disconnected: true, revoked: true, deletedImportedData: false, deletedSubscriptionCount: 0, cloudStateUpdated: false })
    const user = userEvent.setup()
    const { onApply } = renderSubscriptions()
    await waitFor(() => screen.getByText('YouTube Premium'))
    await user.click(screen.getByRole('button', { name: /manage connection/i }))
    await user.click(screen.getByRole('button', { name: 'Disconnect and keep data' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google Subscriptions?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(disconnectGoogleSubscriptions).toHaveBeenCalledWith(false))
    expect(onApply).not.toHaveBeenCalledWith(expect.objectContaining({ subscriptions: [] }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connect a provider to import subscriptions' })).toBeInTheDocument())
  })

  it('remove-data option deletes the imported google subscriptions but never touches Recurring Payments data', async () => {
    mockConnected()
    vi.mocked(disconnectGoogleSubscriptions).mockResolvedValue({ disconnected: true, revoked: true, deletedImportedData: true, deletedSubscriptionCount: 1, cloudStateUpdated: true })
    const user = userEvent.setup()
    const { onApply } = renderSubscriptions()
    await waitFor(() => screen.getByText('YouTube Premium'))
    await user.click(screen.getByRole('button', { name: /manage connection/i }))
    await user.click(screen.getByRole('button', { name: 'Disconnect and remove data' }))
    const dialog = screen.getByRole('dialog', { name: /Disconnect and remove 1 imported subscription/ })
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect and remove' }))
    await waitFor(() => expect(disconnectGoogleSubscriptions).toHaveBeenCalledWith(true))
    const applied = onApply.mock.calls.at(-1)![0] as AppState
    expect(applied.subscriptions).toEqual([])
  })

  it('shows an inline error and leaves the connection as last-known when disconnect fails', async () => {
    mockConnected()
    vi.mocked(disconnectGoogleSubscriptions).mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()
    renderSubscriptions()
    await waitFor(() => screen.getByText('YouTube Premium'))
    await user.click(screen.getByRole('button', { name: /manage connection/i }))
    await user.click(screen.getByRole('button', { name: 'Disconnect and keep data' }))
    const dialog = screen.getByRole('dialog', { name: 'Disconnect Google Subscriptions?' })
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't disconnect. Try again.")
  })
})
