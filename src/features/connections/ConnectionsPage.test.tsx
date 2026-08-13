import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ProviderDescriptor, ProviderInstitution } from '../../connectors'
import type { AppState } from '../../types'
import { ConnectionsPage } from './ConnectionsPage'

// Every provider available and configured by default so tests that don't
// care about availability aren't blocked by it; tests covering the
// unavailable-provider contract (defect 5) override this per-test.
const DEFAULT_PROVIDER_STATUS: ProviderDescriptor[] = [
  { id: 'gocardless', displayName: 'Bank (GoCardless)', kind: 'psd2-account-information', available: true, configured: true },
  { id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: true, mode: 'owner' },
  { id: 'finapi', displayName: 'Bank (finAPI)', kind: 'unavailable', available: false, configured: false, reason: 'finAPI adapter is not configured.' },
]

vi.mock('../../connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../connectors')>()
  return {
    ...actual,
    startConnector: vi.fn(async () => {}),
    synchronizeConnections: vi.fn(async () => []),
    disconnectConnector: vi.fn(async () => {}),
    fetchProviderStatus: vi.fn(async () => DEFAULT_PROVIDER_STATUS),
    fetchProviderInstitutions: vi.fn(async (): Promise<ProviderInstitution[]> => []),
  }
})

// Amount owed / available credit for a manual credit-card account come from
// the real, server-side COBOL banking core (see manualCreditCard.ts) --
// mocked here the same way the connector calls above are, rather than
// exercising a real network request in a component test.
vi.mock('../../manualCreditCard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../manualCreditCard')>()
  return {
    ...actual,
    normalizeManualCreditCard: vi.fn(async ({ providerBalanceCents, creditLimitCents }: { providerBalanceCents: number; creditLimitCents?: number }) => ({
      amountOwedCents: providerBalanceCents,
      ledgerBalanceCents: -providerBalanceCents,
      ...(creditLimitCents ? { availableCreditCents: Math.max(0, creditLimitCents - providerBalanceCents) } : {}),
      pendingAmountCents: 0,
      calculationEngine: 'cobol' as const,
    })),
  }
})

import { disconnectConnector, fetchProviderInstitutions, fetchProviderStatus, startConnector, synchronizeConnections } from '../../connectors'

const baseState: AppState = { accounts: [], transactions: [], goals: [] }

function renderConnections(override: Partial<Parameters<typeof ConnectionsPage>[0]> = {}) {
  const onApply = vi.fn()
  const utils = render(<div>
    <main id="main-content"><button type="button">Outside the dialog</button></main>
    <nav className="app-mobile-navigation"><button type="button">Nav item</button></nav>
    <ConnectionsPage state={baseState} onApply={onApply} {...override}/>
  </div>)
  return { ...utils, onApply }
}

beforeEach(() => vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true'))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  window.history.replaceState({}, document.title, '/')
})

describe('overview', () => {
  it('declares the English feature boundary and renders an honest empty state', () => {
    renderConnections()
    const root = screen.getByLabelText('Connections')
    expect(root).toHaveAttribute('lang', 'en')
    expect(root).toHaveAttribute('data-connections-ready', 'true')
    expect(screen.getByRole('heading', { name: 'Connect your financial accounts' })).toBeInTheDocument()
    expect(screen.queryByText(/Connected accounts/)).not.toBeInTheDocument()
  })

  it('renders the populated overview with honest status text and no invented balances', () => {
    renderConnections({ acceptanceMode: 'populated' })
    expect(screen.getByText('Connected accounts')).toBeInTheDocument()
    expect(screen.getByText('Sparkasse')).toBeInTheDocument()
    expect(screen.getByText('PayPal')).toBeInTheDocument()
    expect(screen.getAllByText('Connection needs attention').length).toBeGreaterThan(0)
    expect(screen.queryByText(/€\d/)).not.toBeInTheDocument()
  })
})

describe('institution search and category filtering', () => {
  it('filters the institution list by category and search term, including long names', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    expect(screen.getByRole('heading', { name: 'Choose your institution' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'PayPal' }))
    expect(screen.getByRole('button', { name: /PayPal/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sparkasse/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Popular' }))
    await user.type(screen.getByPlaceholderText('Search institutions'), 'hypo')
    expect(screen.getByRole('button', { name: /UniCredit Bank – HypoVereinsbank/ })).toBeInTheDocument()
  })

  it('clears the search term', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.type(screen.getByPlaceholderText('Search institutions'), 'ing')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByPlaceholderText('Search institutions')).toHaveValue('')
  })
})

// Trade Republic is backed by finAPI, which defaults to unavailable
// (matching the real backend's explicit UnavailableProvider placeholder --
// see "provider availability" below). These step-mechanics tests aren't
// about availability, so they mark it available for this one call only.
const AVAILABLE_STATUS_WITH_FINAPI: ProviderDescriptor[] = DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'finapi' ? { ...provider, available: true, configured: true, reason: undefined } : provider))

describe('setup step transitions and account-type selection', () => {
  it('sends account-type-required institutions to step 2 with a sensible default selected', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(AVAILABLE_STATUS_WITH_FINAPI)
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(await screen.findByRole('button', { name: /Trade Republic/ }))
    expect(screen.getByRole('heading', { name: 'What would you like to connect?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Investment account/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('sends institutions without a required account type straight to confirmation', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
  })

  it('selecting an account type advances to the confirmation step', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(AVAILABLE_STATUS_WITH_FINAPI)
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(await screen.findByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Checking account/ }))
    expect(screen.getByRole('heading', { name: 'Continue to your provider' })).toBeInTheDocument()
  })
})

describe('GoCardless institution resolution (never guesses a real bank)', () => {
  it('resolves the exact GoCardless institution against the live directory before it can be confirmed', async () => {
    const user = userEvent.setup()
    const match: ProviderInstitution = { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' }
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([match])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    expect(screen.getByRole('heading', { name: /Find your Sparkasse branch/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Continue to your provider' })).not.toBeInTheDocument()

    const bankRow = await screen.findByRole('button', { name: /Aachener Sparkasse/ })
    await user.click(bankRow)
    expect(screen.getByRole('heading', { name: 'Continue to your provider' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(startConnector).toHaveBeenCalledWith('gocardless', { institutionId: 'SPARKASSE_AACHEN_AACSDE33', institutionName: 'Aachener Sparkasse', accountType: 'checking' })
  })

  it('never falls back to a guessed institution and lets the user search when nothing narrows it down', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' },
      { id: 'SPARKASSE_KOELN_COKSDE33', name: 'Sparkasse KoelnBonn', bic: 'COKSDE33' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    await screen.findByRole('button', { name: /Aachener Sparkasse/ })
    expect(screen.getByRole('button', { name: /Sparkasse KoelnBonn/ })).toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()

    const liveSearchInput = screen.getByPlaceholderText('Search by bank name or BIC')
    await user.clear(liveSearchInput)
    await user.type(liveSearchInput, 'Koeln')
    expect(screen.queryByRole('button', { name: /Aachener Sparkasse/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sparkasse KoelnBonn/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /All institutions/ }))
    expect(screen.getByRole('heading', { name: 'Choose your institution' })).toBeInTheDocument()
  })
})

describe('redirect confirmation', () => {
  it('requires explicit confirmation before starting a bank connector, with the correct provider and context', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(AVAILABLE_STATUS_WITH_FINAPI)
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(await screen.findByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Investment account/ }))
    expect(startConnector).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(startConnector).toHaveBeenCalledWith('finapi', { institutionId: 'trade-republic', institutionName: 'Trade Republic', accountType: 'investment' })
  })

  it('uses owner-mode PayPal confirmation copy and starts the paypal provider', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    expect(await screen.findByRole('heading', { name: 'Continue with the owner PayPal connection' })).toBeInTheDocument()
    expect(screen.getByText(/deployment owner.s configured PayPal reporting connection/)).toBeInTheDocument()
    expect(screen.queryByText(/redirected to PayPal.s official site to authenticate/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
    expect(startConnector).toHaveBeenCalledWith('paypal', { institutionId: 'paypal', institutionName: 'PayPal', accountType: 'checking' })
  })

  it('uses partner-mode PayPal confirmation copy for hosted onboarding', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'paypal' ? { ...provider, mode: 'partner' as const } : provider)))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    expect(await screen.findByRole('heading', { name: 'Continue to PayPal' })).toBeInTheDocument()
    expect(screen.getByText(/redirected to PayPal.s hosted onboarding/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to PayPal' }))
    expect(startConnector).toHaveBeenCalledWith('paypal', { institutionId: 'paypal', institutionName: 'PayPal', accountType: 'checking' })
  })

  it('shows an unavailable state instead of a live PayPal redirect when PayPal is not configured', async () => {
    const user = userEvent.setup()
    let resolveStatus!: (value: ProviderDescriptor[]) => void
    vi.mocked(fetchProviderStatus).mockImplementationOnce(() => new Promise((resolve) => { resolveStatus = resolve }))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    resolveStatus(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'paypal' ? { ...provider, available: false, configured: false, reason: 'PayPal credentials are not configured.' } : provider)))
    expect(await screen.findByRole('heading', { name: "PayPal isn't available right now" })).toBeInTheDocument()
    expect(screen.getByText('PayPal credentials are not configured.')).toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()
  })

  it('Cancel does not start a provider', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(startConnector).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Continue to PayPal' })).not.toBeInTheDocument()
  })

  it('routes manual institutions directly to the manual-account form instead of a redirect', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Cards' }))
    await user.click(screen.getByRole('button', { name: /Kreditkarte manuell/ }))
    expect(screen.getByRole('heading', { name: 'Add manual account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Account type')).toHaveValue('credit-card')
    expect(startConnector).not.toHaveBeenCalled()
  })
})

describe('provider-start error visibility (defect: hidden behind the modal)', () => {
  it('shows a provider-start failure inside the active setup dialog and supports retry', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(AVAILABLE_STATUS_WITH_FINAPI)
    vi.mocked(startConnector).mockRejectedValueOnce(new Error('GoCardless is not configured.'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(await screen.findByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Investment account/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))

    const dialog = screen.getByRole('dialog')
    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('GoCardless is not configured.')

    const confirmButton = screen.getByRole('button', { name: 'Continue securely' })
    expect(confirmButton).not.toBeDisabled()
    await user.click(confirmButton)
    expect(startConnector).toHaveBeenCalledTimes(2)
  })

  it('clears a stale setup error when the institution or step changes', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(AVAILABLE_STATUS_WITH_FINAPI)
    vi.mocked(startConnector).mockRejectedValueOnce(new Error('Boom.'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(await screen.findByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Investment account/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom.')

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears a stale setup error when the dialog is closed and reopened', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(AVAILABLE_STATUS_WITH_FINAPI)
    vi.mocked(startConnector).mockRejectedValueOnce(new Error('Boom.'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(await screen.findByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Investment account/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Boom.')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('provider availability (defect: unavailable providers masquerading as working)', () => {
  it('marks an unavailable provider institution instead of letting it masquerade as connectable', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    const tradeRepublicRow = screen.getByRole('button', { name: /Trade Republic/ })
    await waitFor(() => expect(tradeRepublicRow).toBeDisabled())
    expect(within(tradeRepublicRow).getByText(/Unavailable/)).toBeInTheDocument()
    await user.click(tradeRepublicRow)
    expect(screen.queryByRole('heading', { name: 'What would you like to connect?' })).not.toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()
  })
})

describe('provider callback handling', () => {
  it('strips callback parameters from the URL and checks the connection before showing results', async () => {
    window.history.pushState({}, '', '/?code=abc&state=xyz&provider=gocardless')
    let resolveSync!: (value: Awaited<ReturnType<typeof synchronizeConnections>>) => void
    ;(synchronizeConnections as Mock).mockImplementation(() => new Promise((resolve) => { resolveSync = resolve }))
    renderConnections()
    expect(window.location.search).toBe('')
    expect(screen.getByRole('heading', { name: 'Checking your connection' })).toBeInTheDocument()
    resolveSync([])
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Checking your connection' })).not.toBeInTheDocument())
    expect(synchronizeConnections).toHaveBeenCalledTimes(1)
  })

  it('shows an honest error for a provider callback error without calling synchronize', () => {
    window.history.pushState({}, '', '/?error=access_denied&error_description=User+cancelled')
    renderConnections()
    expect(screen.getByRole('alert')).toHaveTextContent(/not completed/)
    expect(synchronizeConnections).not.toHaveBeenCalled()
  })
})

describe('synchronization preview and account selection', () => {
  it('reconciles the selected-count summary with checked rows and excludes unselected accounts from import', async () => {
    const user = userEvent.setup()
    const { onApply } = renderConnections({ acceptanceMode: 'sync-selection' })
    expect(screen.getByText('3 of 3')).toBeInTheDocument()
    const checkingRow = screen.getByText('Checking account').closest('label')!
    await user.click(within(checkingRow).getByRole('checkbox'))
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Import selected accounts' }))
    const [nextState] = onApply.mock.calls[0]
    expect(nextState.accounts.map((account: { name: string }) => account.name)).toEqual(['Savings account', 'Credit card'])
    expect(nextState.transactions).toHaveLength(0)
  })

  it('does not import before explicit confirmation, and Cancel discards the preview', async () => {
    const user = userEvent.setup()
    const { onApply } = renderConnections({ acceptanceMode: 'sync-selection' })
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByText('Choose accounts')).not.toBeInTheDocument()
  })

  it('offers to undo the last import after confirming', async () => {
    const user = userEvent.setup()
    const { onApply } = renderConnections({ acceptanceMode: 'sync-selection' })
    await user.click(screen.getByRole('button', { name: 'Import selected accounts' }))
    await user.click(screen.getByRole('button', { name: 'Undo last import' }))
    expect(onApply).toHaveBeenCalledTimes(2)
    expect(onApply.mock.calls[1][0]).toEqual(baseState)
  })
})

describe('connection attention, reconnect and disconnect', () => {
  it('shows the attention reason and lets the user reconnect', async () => {
    const user = userEvent.setup()
    renderConnections({ acceptanceMode: 'attention' })
    expect(screen.getByRole('heading', { name: 'Connection needs attention' })).toBeInTheDocument()
    expect(screen.getByText('Provider error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reconnect/ }))
    expect(startConnector).toHaveBeenCalledWith('finapi', {})
  })

  it('requires explicit confirmation before disconnecting, and preserves imported data in the copy', async () => {
    const user = userEvent.setup()
    renderConnections({ acceptanceMode: 'attention' })
    await user.click(screen.getByRole('button', { name: /^Disconnect$/ }))
    expect(disconnectConnector).not.toHaveBeenCalled()
    expect(screen.getByText(/Transactions already imported will stay in Finance Planner/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(disconnectConnector).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /^Disconnect$/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    expect(disconnectConnector).toHaveBeenCalledWith('finapi')
  })

  it('shows a reconnect failure inside the attention screen and supports retry', async () => {
    const user = userEvent.setup()
    vi.mocked(startConnector).mockRejectedValueOnce(new Error('The connection could not be started.'))
    renderConnections({ acceptanceMode: 'attention' })
    await user.click(screen.getByRole('button', { name: /Reconnect/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The connection could not be started.')
    await user.click(screen.getByRole('button', { name: /Reconnect/ }))
    expect(startConnector).toHaveBeenCalledTimes(2)
  })

  it('shows a disconnect failure inside the attention screen', async () => {
    const user = userEvent.setup()
    vi.mocked(disconnectConnector).mockRejectedValueOnce(new Error('The connection could not be disconnected.'))
    renderConnections({ acceptanceMode: 'attention' })
    await user.click(screen.getByRole('button', { name: /^Disconnect$/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The connection could not be disconnected.')
  })
})

describe('manual account', () => {
  it('shows the credit limit field only for credit cards and validates required fields', async () => {
    const user = userEvent.setup()
    const { onApply } = renderConnections({ acceptanceMode: 'manual' })
    expect(screen.queryByLabelText(/Credit limit \(optional\)/)).not.toBeInTheDocument()
    const typeSelect = screen.getByLabelText('Account type')
    await user.selectOptions(typeSelect, 'credit-card')
    expect(typeSelect).toHaveValue('credit-card')
    expect(screen.getByLabelText(/Credit limit \(optional\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save account' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an account name.')
    expect(onApply).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Account name'), 'Everyday credit card')
    await user.type(screen.getByLabelText(/Current balance/), '250.75')
    await user.click(screen.getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(onApply).toHaveBeenCalled())
    const [nextState] = onApply.mock.calls[0]
    expect(nextState.accounts[0]).toMatchObject({ name: 'Everyday credit card', type: 'credit-card', balanceCents: -25_075, creditCard: { amountOwedCents: 25_075 } })
  })

  it('surfaces a credit-card calculation failure without saving a local fallback', async () => {
    const { normalizeManualCreditCard } = await import('../../manualCreditCard')
    vi.mocked(normalizeManualCreditCard).mockRejectedValueOnce(new Error('Compiled COBOL banking core is unavailable.'))
    const user = userEvent.setup()
    const { onApply } = renderConnections({ acceptanceMode: 'manual' })
    await user.selectOptions(screen.getByLabelText('Account type'), 'credit-card')
    await user.type(screen.getByLabelText('Account name'), 'Everyday credit card')
    await user.type(screen.getByLabelText(/Current balance/), '250.75')
    await user.click(screen.getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Compiled COBOL banking core is unavailable.'))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('never asks for card, PIN or password fields', () => {
    renderConnections({ acceptanceMode: 'manual' })
    const labels = screen.getAllByText((_, element) => element?.tagName.toLowerCase() === 'span' && Boolean(element.parentElement && element.parentElement.tagName.toLowerCase() === 'label')).map((el) => el.textContent)
    for (const forbidden of [/card number/i, /expiry/i, /cvc/i, /\bpin\b/i, /bank password/i, /paypal password/i, /\btan\b/i]) {
      expect(labels.some((label) => forbidden.test(label ?? ''))).toBe(false)
    }
    expect(screen.getByText(/Finance Planner never requests card number, expiry, CVC, PIN or login credentials\./)).toBeInTheDocument()
  })
})

describe('statement import', () => {
  it('rejects files larger than 5MB', () => {
    renderConnections()
    const input = document.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['data'], 'statement.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [file] } })
    expect(screen.getByRole('alert')).toHaveTextContent('larger than 5 MB')
  })

  it('previews before import and only imports after explicit confirmation', async () => {
    const user = userEvent.setup()
    const { onApply } = renderConnections({ acceptanceMode: 'statement-preview' })
    expect(screen.getByText('Detected transactions')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Review required')).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Import reviewed transactions/ }))
    expect(onApply).toHaveBeenCalledTimes(1)
  })
})

describe('dialog accessibility', () => {
  it('traps focus, supports Escape, restores focus, and makes the background inert', async () => {
    const user = userEvent.setup()
    renderConnections()
    const trigger = screen.getByRole('button', { name: 'Connect an account' })
    await user.click(trigger)
    await waitFor(() => expect(screen.getByPlaceholderText('Search institutions')).toHaveFocus())
    expect(document.getElementById('main-content')).toHaveAttribute('inert')
    expect(document.querySelector('.app-mobile-navigation')).toHaveAttribute('inert')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(document.getElementById('main-content')).not.toHaveAttribute('inert')
  })
})
