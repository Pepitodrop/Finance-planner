import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ConnectorConnection, ProviderDescriptor, ProviderInstitution } from '../../connectors'
import type { AppState } from '../../types'
import { ConnectionsPage } from './ConnectionsPage'

// Every provider available and configured by default so tests that don't
// care about availability aren't blocked by it; tests covering the
// unavailable-provider contract (defect 5) override this per-test.
// Enable Banking is deliberately NOT configured by default here -- most
// deployments won't have it set up on day one, and the existing GoCardless-
// focused resolution tests below rely on GoCardless being the resolved AIS
// provider without needing to override anything. Tests covering the
// Enable-Banking-preferred path override this per-test.
const DEFAULT_PROVIDER_STATUS: ProviderDescriptor[] = [
  { id: 'enablebanking', displayName: 'Bank connection', kind: 'psd2-account-information', available: false, configured: false },
  { id: 'gocardless', displayName: 'Bank (GoCardless)', kind: 'psd2-account-information', available: true, configured: true },
  { id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', available: true, configured: true, mode: 'owner' },
  { id: 'finapi', displayName: 'Bank (finAPI)', kind: 'unavailable', available: false, configured: false, reason: 'finAPI adapter is not configured.' },
]

vi.mock('../../connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../connectors')>()
  return {
    ...actual,
    // 'redirect' by default -- matches every existing provider's real
    // behavior (the browser is already navigating away by the time this
    // resolves) and keeps every pre-existing test in this file unaffected.
    // The Enable-Banking-embedded-widget describe block below overrides
    // this per-test with an 'embedded-auth' result.
    startConnector: vi.fn(async () => ({ mode: 'redirect' as const })),
    synchronizeConnections: vi.fn(async () => []),
    disconnectConnector: vi.fn(async () => ({ disconnected: true, providerRevoked: true, providerRevokeReason: 'confirmed' as const })),
    fetchProviderStatus: vi.fn(async () => DEFAULT_PROVIDER_STATUS),
    fetchProviderInstitutions: vi.fn(async (): Promise<ProviderInstitution[]> => []),
    // No stored connections by default -- tests covering the persisted-
    // connection-survives-remount contract (defect: connection disappears
    // on navigation) override this per-test.
    fetchStoredConnections: vi.fn(async () => []),
    excludeProviderAccount: vi.fn(async () => undefined),
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

import { disconnectConnector, fetchProviderInstitutions, fetchProviderStatus, fetchStoredConnections, startConnector, synchronizeConnections } from '../../connectors'

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

    const liveSearchInput = screen.getByPlaceholderText('Search bank, city or BIC')
    await user.clear(liveSearchInput)
    await user.type(liveSearchInput, 'Koeln')
    expect(screen.queryByRole('button', { name: /Aachener Sparkasse/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sparkasse KoelnBonn/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /All institutions/ }))
    expect(screen.getByRole('heading', { name: 'Choose your institution' })).toBeInTheDocument()
  })

  it('does not carry a resolved GoCardless bank name over onto a different institution chosen afterward', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce([
      ...DEFAULT_PROVIDER_STATUS.filter((provider) => provider.id !== 'finapi'),
      { id: 'finapi', displayName: 'Bank (finAPI)', kind: 'brokerage', available: true, configured: true },
    ])
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    await user.click(await screen.findByRole('button', { name: /Aachener Sparkasse/ }))
    expect(screen.getByRole('heading', { name: 'Continue to your provider' })).toBeInTheDocument()
    expect(screen.getByText('Aachener Sparkasse')).toBeInTheDocument()

    // Back to the institution picker without disconnecting -- resolvingInstitution
    // is already null here (resolution completed), so this exercises the header
    // back button's plain setSetupStep(1) path, not cancelInstitutionResolution().
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: /^Trade Republic$/ }))

    expect(screen.getByRole('heading', { name: 'What would you like to connect?' })).toBeInTheDocument()
    expect(screen.queryByText('Aachener Sparkasse')).not.toBeInTheDocument()
  })

  it('shows a loading state while the live bank directory is being fetched', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockImplementationOnce(() => new Promise(() => {})) // never resolves: pins the loading state
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    expect(screen.getByText('Loading banks…')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows an error, not a crash or silent empty list, when the live bank directory fails to load', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockRejectedValueOnce(new Error('The bank directory could not be loaded.'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The bank directory could not be loaded.')
    expect(screen.queryByText('Loading banks…')).not.toBeInTheDocument()
  })

  it('shows an honest empty-results message when the live search matches nothing', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    await screen.findByRole('button', { name: /Aachener Sparkasse/ })

    const liveSearchInput = screen.getByPlaceholderText('Search bank, city or BIC')
    await user.type(liveSearchInput, 'zzz-no-such-bank')
    expect(screen.queryByRole('button', { name: /Aachener Sparkasse/ })).not.toBeInTheDocument()
    expect(screen.getByText('No bank matches your search. Try a different name or BIC.')).toBeInTheDocument()
  })

  it('returns to the institution picker via the header Back arrow during live resolution, same as the in-step "All institutions" link', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    await screen.findByRole('heading', { name: /Find your Sparkasse branch/ })

    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Choose your institution' })).toBeInTheDocument()
  })
})

// Regression coverage for the reported UX defect: choosing the "Volksbank /
// Raiffeisenbank" picker tile opened a branch search prefilled with that
// entire literal label ("Volksbank / Raiffeisenbank"), which never matched a
// real ASPSP name ("Volksbank Demmin", "Raiffeisenbank Grävenwiesbach", ...)
// -- see FinancePlanner/Providers/Enable Banking.md and connectionsModel.ts's
// familyFilteredInstitutions().
describe('bank-family resolution (institutions.ts directoryTerms, never the literal picker label)', () => {
  it('opens the branch search with a blank query and shows real branches immediately, never a dead "no results" for the exact bug report', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin' },
      { id: 'DE:Raiffeisenbank Grävenwiesbach', name: 'Raiffeisenbank Grävenwiesbach' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    await screen.findByRole('heading', { name: /Find your Volksbank \/ Raiffeisenbank branch/ })

    const liveSearchInput = screen.getByPlaceholderText('Search bank, city or BIC')
    expect(liveSearchInput).toHaveValue('')
    expect(await screen.findByRole('button', { name: /Volksbank Demmin/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Raiffeisenbank Grävenwiesbach/ })).toBeInTheDocument()
    expect(screen.queryByText(/No bank matches your search/)).not.toBeInTheDocument()
  })

  it('renders each live branch row with the same-origin logo proxy, never a direct link to a provider-controlled host, and falls back to the lettermark on image error', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))

    const row = await screen.findByRole('button', { name: /Volksbank Demmin/ })
    const image = row.querySelector('img')
    expect(image).toBeTruthy()
    expect(image).toHaveAttribute('src', '/api/connectors/enablebanking/logo?institutionId=DE%3AVolksbank%20Demmin')

    fireEvent.error(image!)
    expect(row.querySelector('img')).not.toBeInTheDocument()
    expect(row.querySelector('.connections-mark--lettermark')).toBeInTheDocument()
  })

  it('narrows to real cooperative-network branches via Enable Banking group.name, filtering out an unrelated bank in the same directory', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'DE:Semper Bank AG', name: 'Semper Bank AG', group: { name: 'Volksbanken Raiffeisenbanken' } },
      { id: 'DE:ING-DiBa', name: 'ING-DiBa' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    expect(await screen.findByRole('button', { name: /Semper Bank AG/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ING-DiBa/ })).not.toBeInTheDocument()
  })

  it('tells the user when the family narrowing found nothing and fell back to the whole directory, instead of silently showing unrelated banks', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    expect(await screen.findByRole('button', { name: /ING-DiBa/ })).toBeInTheDocument()
    expect(screen.getByText(/Volksbank \/ Raiffeisenbank wasn.t found under this connection method/)).toBeInTheDocument()
  })

  it('does not show the unnarrowed notice once real family matches are found', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    expect(await screen.findByRole('button', { name: /Volksbank Demmin/ })).toBeInTheDocument()
    expect(screen.queryByText(/wasn.t found under this connection method/)).not.toBeInTheDocument()
  })

  it('lets Retry re-fetch the live directory after a load failure, without leaving the resolution step', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions)
      .mockRejectedValueOnce(new Error('The bank directory could not be loaded.'))
      .mockResolvedValueOnce([{ id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The bank directory could not be loaded.')

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /Volksbank Demmin/ })).toBeInTheDocument()
    expect(fetchProviderInstitutions).toHaveBeenCalledTimes(2)
  })

  it('lets the user clear the search and add a manual account from the empty-results state, and never implies the bank is unsupported', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    await screen.findByRole('button', { name: /Volksbank Demmin/ })

    const liveSearchInput = screen.getByPlaceholderText('Search bank, city or BIC')
    await user.type(liveSearchInput, 'zzz-no-such-bank')
    await screen.findByText('No bank matches your search. Try a different name or BIC.')

    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(liveSearchInput).toHaveValue('')
    expect(await screen.findByRole('button', { name: /Volksbank Demmin/ })).toBeInTheDocument()

    await user.type(liveSearchInput, 'zzz-no-such-bank')
    await screen.findByText('No bank matches your search. Try a different name or BIC.')
    await user.click(screen.getByRole('button', { name: 'Add a manual account instead' }))
    expect(screen.getByRole('heading', { name: 'Add manual account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Account name')).toHaveValue('Volksbank / Raiffeisenbank')
  })
})

describe('top-level search reaching a concrete live bank the static catalogue does not list', () => {
  it('offers an explicit "search the full bank directory" action only once the static list comes up empty, and resolving a match skips straight to confirmation', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:Berliner Volksbank', name: 'Berliner Volksbank', bic: 'BEVODEBBXXX' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    expect(screen.queryByRole('button', { name: /Search the full bank directory/ })).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Search institutions'), 'Berliner Volksbank')
    const searchAction = await screen.findByRole('button', { name: /Search the full bank directory for "Berliner Volksbank"/ })
    await user.click(searchAction)

    expect(fetchProviderInstitutions).toHaveBeenCalledWith('gocardless', 'DE')
    await user.click(await screen.findByRole('button', { name: /Berliner Volksbank/ }))
    expect(screen.getByRole('heading', { name: 'Continue to your provider' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(startConnector).toHaveBeenCalledWith('gocardless', { institutionId: 'DE:Berliner Volksbank', institutionName: 'Berliner Volksbank', accountType: 'checking' })
  })

  it('does not offer the live-directory search action when no AIS provider is available', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (
      provider.id === 'gocardless' || provider.id === 'enablebanking' ? { ...provider, available: false, configured: false } : provider
    )))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.type(screen.getByPlaceholderText('Search institutions'), 'Berliner Volksbank')
    expect(screen.queryByRole('button', { name: /Search the full bank directory/ })).not.toBeInTheDocument()
  })

  it('shows an error with Retry when the live directory fails to load via this entry point too, distinct from the family-tile path', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderInstitutions)
      .mockRejectedValueOnce(new Error('The bank directory could not be loaded.'))
      .mockResolvedValueOnce([{ id: 'DE:Berliner Volksbank', name: 'Berliner Volksbank' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.type(screen.getByPlaceholderText('Search institutions'), 'Berliner Volksbank')
    await user.click(await screen.findByRole('button', { name: /Search the full bank directory for "Berliner Volksbank"/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The bank directory could not be loaded.')

    await user.click(within(alert).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: /Berliner Volksbank/ })).toBeInTheDocument()
    expect(fetchProviderInstitutions).toHaveBeenCalledTimes(2)
  })
})

describe('AIS provider resolution (Enable Banking preferred, GoCardless fallback, never a silent switch)', () => {
  it('resolves against Enable Banking, not GoCardless, when Enable Banking is available and configured', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await screen.findByRole('heading', { name: /Find your ING branch/ })
    expect(fetchProviderInstitutions).toHaveBeenCalledWith('enablebanking', 'DE')

    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(startConnector).toHaveBeenCalledWith('enablebanking', { institutionId: 'DE:ING-DiBa', institutionName: 'ING-DiBa', accountType: 'checking' })
  })

  it('falls back to GoCardless transparently, with no extra "choose a provider" screen, when Enable Banking is unconfigured', async () => {
    // DEFAULT_PROVIDER_STATUS already leaves Enable Banking unconfigured.
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' }])
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    expect(fetchProviderInstitutions).toHaveBeenCalledWith('gocardless', 'DE')
    expect(screen.queryByText(/Enable Banking/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /choose.*provider/i })).not.toBeInTheDocument()
  })

  it('marks bank institutions unavailable, never guessing a provider, when neither Enable Banking nor GoCardless resolves', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (
      provider.id === 'gocardless' || provider.id === 'enablebanking' ? { ...provider, available: false, configured: false } : provider
    )))
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    const ingRow = await screen.findByRole('button', { name: /^ING/ })
    await waitFor(() => expect(ingRow).toBeDisabled())
    expect(within(ingRow).getByText('Bank connections are not available right now.')).toBeInTheDocument()
    expect(fetchProviderInstitutions).not.toHaveBeenCalled()
  })

  it('offers an explicit, user-initiated fallback to GoCardless when the Enable Banking search comes back empty and GoCardless is independently available -- never switches silently', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33' }])
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    await screen.findByText('No bank matches your search. Try a different name or BIC.')
    expect(fetchProviderInstitutions).toHaveBeenNthCalledWith(1, 'enablebanking', 'DE')

    const fallbackButton = await screen.findByRole('button', { name: 'Try another connection method' })
    await user.click(fallbackButton)

    expect(fetchProviderInstitutions).toHaveBeenNthCalledWith(2, 'gocardless', 'DE')
    expect(await screen.findByRole('button', { name: /Aachener Sparkasse/ })).toBeInTheDocument()
  })

  it('never offers the fallback action when GoCardless itself is not independently available -- there is nothing to fall back to', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => {
      if (provider.id === 'enablebanking') return { ...provider, available: true, configured: true }
      if (provider.id === 'gocardless') return { ...provider, available: false, configured: false }
      return provider
    }))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([])
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Sparkasse$/ }))
    await screen.findByText('No bank matches your search. Try a different name or BIC.')
    expect(screen.queryByRole('button', { name: 'Try another connection method' })).not.toBeInTheDocument()
  })

  it('keeps the provider fixed for the whole attempt once resolution has started -- startConnector always targets the provider chosen at resolution time', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(startConnector).toHaveBeenCalledTimes(1)
    expect(startConnector).toHaveBeenCalledWith('enablebanking', expect.objectContaining({ institutionId: 'DE:ING-DiBa' }))
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

  it('shows the resolved live bank\'s own logo (via the same-origin proxy) on the Step 3 confirmation header, not the family tile\'s generic icon', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:Volksbank Köln Bonn', name: 'Volksbank Köln Bonn' }])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    await user.click(await screen.findByRole('button', { name: /Volksbank Köln Bonn/ }))
    await screen.findByRole('heading', { name: 'Continue to your provider' })

    const image = document.querySelector('.connections-institution-banner img')
    expect(image).toHaveAttribute('src', '/api/connectors/enablebanking/logo?institutionId=DE%3AVolksbank%20K%C3%B6ln%20Bonn')
  })

  it('shows the newly resolved bank\'s own logo on the confirmation header after backing out and resolving a different bank, never the previous bank\'s (failed) image', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    // One directory fetch covering both banks -- the live-directory cache
    // persists for the rest of the setup session by design, so a second
    // resolution of the same family tile reuses it rather than refetching.
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([
      { id: 'DE:Volksbank Köln Bonn', name: 'Volksbank Köln Bonn' },
      { id: 'DE:Volksbank Demmin', name: 'Volksbank Demmin' },
    ])
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    await user.click(await screen.findByRole('button', { name: /Volksbank Köln Bonn/ }))
    await screen.findByRole('heading', { name: 'Continue to your provider' })
    fireEvent.error(document.querySelector('.connections-institution-banner img')!)
    expect(document.querySelector('.connections-institution-banner img')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: /^Volksbank \/ Raiffeisenbank$/ }))
    await user.click(await screen.findByRole('button', { name: /Volksbank Demmin/ }))
    await screen.findByRole('heading', { name: 'Continue to your provider' })

    const secondImage = document.querySelector('.connections-institution-banner img')
    expect(secondImage).toHaveAttribute('src', '/api/connectors/enablebanking/logo?institutionId=DE%3AVolksbank%20Demmin')
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
    renderConnections({ acceptanceMode: 'paypal-unconfigured' })
    expect(screen.getByRole('heading', { name: "PayPal isn't available right now" })).toBeInTheDocument()
    expect(screen.getByText('PayPal credentials are not configured.')).toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()
  })

  it('never lets PayPal be selected from the picker while its unavailability is genuinely a live race (provider status flips after the row was already known-available)', async () => {
    // This exercises the narrow legitimate race the unavailable-copy branch
    // still defends against: status was 'ready'/available when the row was
    // rendered, and only turns unavailable while the user is already on the
    // confirmation step (the picker itself now fails closed for every other
    // timing, per institutionAvailability()).
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    const paypalRow = await screen.findByRole('button', { name: /^PayPal$/ })
    await waitFor(() => expect(paypalRow).not.toBeDisabled())
    await user.click(paypalRow)
    expect(screen.getByRole('heading', { name: 'Continue with the owner PayPal connection' })).toBeInTheDocument()
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

describe('provider authorization popup (fixed 2026-08-25: a successful popup launch is not the same as a same-tab redirect)', () => {
  function fakePopupAttempt(overrides: Partial<{ closed: boolean }> = {}) {
    const close = vi.fn()
    const popup = { closed: overrides.closed ?? false, close } as unknown as Window
    return { attempt: { attemptId: 'popup-attempt-1234567890', provider: 'paypal' as const, createdAt: Date.now(), popup }, close }
  }

  it('does not leave the modal permanently busy -- clears busy and shows an explicit calm waiting state', async () => {
    const { attempt } = fakePopupAttempt()
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'popup', attempt })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))

    expect(await screen.findByRole('heading', { name: 'Continue in the secure window' })).toBeInTheDocument()
    expect(screen.getByText(/Bank authorization opened in a secure window/)).toBeInTheDocument()
    // The Cancel action must be reachable -- it would be disabled/unreachable
    // if `busy` had incorrectly stayed true, exactly the bug this fixes.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  // Regression for the COOP/popup.closed finding (PR #154 review,
  // 2026-08-25): Finance Planner sends `Cross-Origin-Opener-Policy:
  // same-origin`, which severs this tab's WindowProxy reference to the
  // popup once it navigates cross-origin to the real provider -- `.closed`
  // can then read `true` even though the authorization window is genuinely
  // still open. There must be no polling left that reacts to this at all:
  // the waiting UI stays exactly as-is even when the handle already reports
  // closed:true from the very start (the worst case -- a fully "severed"
  // handle) and stays that way well past the old 500ms poll interval.
  it('never shows a false "Secure window closed" state, even when the popup handle already reads closed:true (a COOP-severed handle)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { attempt } = fakePopupAttempt({ closed: true })
      vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'popup', attempt })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      renderConnections()
      await user.click(screen.getByRole('button', { name: 'Connect an account' }))
      await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
      await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
      await screen.findByRole('heading', { name: 'Continue in the secure window' })

      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

      expect(screen.getByRole('heading', { name: 'Continue in the secure window' })).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Secure window closed' })).not.toBeInTheDocument()
      expect(screen.queryByText(/secure window was closed/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Try again" is always available as a manual action (never gated on any auto-detected close) and abandons the current popup before starting a fresh one', async () => {
    const first = fakePopupAttempt()
    const second = fakePopupAttempt()
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'popup', attempt: first.attempt }).mockResolvedValueOnce({ mode: 'popup', attempt: second.attempt })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
    await screen.findByRole('heading', { name: 'Continue in the secure window' })

    // Available immediately -- not conditional on any closed-detection.
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    // The first (possibly still-live) popup must be closed before a second
    // one opens, so a user who retries can never end up with two concurrent
    // authorization attempts for the same connection.
    expect(first.close).toHaveBeenCalled()
    expect(startConnector).toHaveBeenCalledTimes(2)
    expect(await screen.findByRole('heading', { name: 'Continue in the secure window' })).toBeInTheDocument()
  })

  it('Cancel while waiting closes the real popup window, not just the React state', async () => {
    const { attempt, close } = fakePopupAttempt()
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'popup', attempt })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
    await screen.findByRole('heading', { name: 'Continue in the secure window' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(close).toHaveBeenCalled()
  })

  it('the Back arrow collapses one level (closing the real popup) rather than leaving Step 3 entirely', async () => {
    const { attempt, close } = fakePopupAttempt()
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'popup', attempt })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
    await screen.findByRole('heading', { name: 'Continue in the secure window' })

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(close).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Continue in the secure window' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Continue with the owner PayPal connection' })).toBeInTheDocument()
  })

  it('closing and reopening the setup dialog abandons any still-open popup from a previous attempt', async () => {
    const { attempt, close } = fakePopupAttempt()
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'popup', attempt })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
    await screen.findByRole('heading', { name: 'Continue in the secure window' })

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(close).toHaveBeenCalled()
  })
})

describe('Enable Banking Auth Flow widget', () => {
  it('1. stays on the setup modal and shows the secure-authorization loading state instead of navigating away when a valid embedded-auth descriptor is returned', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: false })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))

    expect(await screen.findByRole('heading', { name: 'Secure bank authorization' })).toBeInTheDocument()
    expect(screen.getByText('Finance Planner never receives your online-banking credentials.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Continue to your provider' })).not.toBeInTheDocument()
    expect(screen.getByText('Preparing secure bank authorization…')).toBeInTheDocument()
  })

  it('does not disable the widget view behind a permanently-busy Continue button -- busy is cleared once the embedded-auth result lands', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: false })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    await screen.findByRole('heading', { name: 'Secure bank authorization' })
    // The widget view's own Cancel button must be interactable, not stuck
    // disabled by a `busy` flag that was never cleared.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('13. backing out of the widget view and choosing a different institution shows the plain confirmation view again, never a stale widget', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValue([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: false })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    await screen.findByRole('heading', { name: 'Secure bank authorization' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Secure bank authorization' })).not.toBeInTheDocument()
  })

  it('12. closing and reopening the setup dialog never reuses a previous attempt\'s widget -- reopening starts at the institution picker', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValue(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: false })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    await screen.findByRole('heading', { name: 'Secure bank authorization' })

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    expect(screen.queryByRole('heading', { name: 'Secure bank authorization' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Choose your institution' })).toBeInTheDocument()
  })

  it('11. shows no credential-shaped input anywhere in the setup modal while the widget view is active', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: false })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    await screen.findByRole('heading', { name: 'Secure bank authorization' })

    expect(document.querySelectorAll('.connections-setup-modal input')).toHaveLength(0)
  })

  it('15. the widget frame is a live region and the Cancel action stays a real, keyboard-reachable button', async () => {
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'enablebanking' ? { ...provider, available: true, configured: true } : provider)))
    vi.mocked(fetchProviderInstitutions).mockResolvedValueOnce([{ id: 'DE:ING-DiBa', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }])
    vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: false })
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^ING/ }))
    await user.click(await screen.findByRole('button', { name: /ING-DiBa/ }))
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    await screen.findByRole('heading', { name: 'Secure bank authorization' })

    expect(document.querySelector('.connections-auth-flow-frame')).toHaveAttribute('aria-live', 'polite')
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    expect(cancelButton.tagName).toBe('BUTTON')
    cancelButton.focus()
    expect(cancelButton).toHaveFocus()
  })

  describe('deterministic fixture states (acceptanceMode, never contacting the real widget script)', () => {
    it('7. renders the loading shell via the enablebanking-auth-flow-loading fixture', () => {
      renderConnections({ acceptanceMode: 'enablebanking-auth-flow-loading' })
      expect(screen.getByRole('heading', { name: 'Secure bank authorization' })).toBeInTheDocument()
      expect(screen.getByText('Preparing secure bank authorization…')).toBeInTheDocument()
    })

    it('8/10. renders the error fallback via the enablebanking-auth-flow-error fixture, and its fallback button redirects only to the validated redirectUrl from /start', () => {
      const assignSpy = vi.fn()
      const originalLocation = window.location
      Object.defineProperty(window, 'location', { value: { ...originalLocation, assign: assignSpy }, writable: true })
      try {
        renderConnections({ acceptanceMode: 'enablebanking-auth-flow-error' })
        expect(screen.getByText(/couldn.t load/)).toBeInTheDocument()
        const fallbackButton = screen.getByRole('button', { name: 'Open secure provider page' })
        fireEvent.click(fallbackButton)
        expect(assignSpy).toHaveBeenCalledWith('https://tilisy-sandbox.enablebanking.com/ais/00000000-0000-0000-0000-000000000000')
        // Never automatically redirected without this explicit user action.
        expect(assignSpy).toHaveBeenCalledTimes(1)
      } finally {
        Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
      }
    })

    it('the error fixture also offers Try again, without ever calling the fallback redirect on its own', () => {
      renderConnections({ acceptanceMode: 'enablebanking-auth-flow-error' })
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    })

    // Regression coverage (correctness review, 2026-08-22): the Back-arrow
    // collapse handler used to clear embeddedAuthFlow but not
    // authFlowFixtureStatus, so backing out of a fixture-error widget view
    // and then starting a REAL Enable Banking attempt right after left the
    // real widget permanently short-circuited into the stale fixture's
    // 'error' status -- it would never even attempt to load. Only reachable
    // in a VITE_ACCEPTANCE_FIXTURES=true build, but a genuine state leak.
    it('backing out of the error fixture and then starting a real attempt does not leave the real widget stuck in the fixture\'s error status', async () => {
      const user = userEvent.setup()
      vi.mocked(startConnector).mockResolvedValueOnce({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/real-auth', authorizationId: 'real-auth', origin: 'https://auth.enablebanking.com', sandbox: false })
      renderConnections({ acceptanceMode: 'enablebanking-auth-flow-error' })
      expect(screen.getByText(/couldn.t load/)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(screen.queryByText(/couldn.t load/)).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Continue securely' }))

      await screen.findByRole('heading', { name: 'Secure bank authorization' })
      // Must show the real widget's own initial loading state, never the
      // stale fixture's error state carried over from before Back.
      expect(screen.getByText('Preparing secure bank authorization…')).toBeInTheDocument()
      expect(screen.queryByText(/couldn.t load/)).not.toBeInTheDocument()
    })
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
    expect(within(tradeRepublicRow).getByText('finAPI adapter is not configured.')).toBeInTheDocument()
    await user.click(tradeRepublicRow)
    expect(screen.queryByRole('heading', { name: 'What would you like to connect?' })).not.toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()
  })
})

describe('provider status lifecycle (fails closed, never optimistic)', () => {
  it('shows a calm checking state and blocks every external provider while status is loading -- manual accounts stay usable', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockImplementationOnce(() => new Promise(() => {})) // never resolves: pins the loading state
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))

    const sparkasseRow = screen.getByRole('button', { name: /^Sparkasse/ })
    expect(sparkasseRow).toBeDisabled()
    expect(within(sparkasseRow).getByText('Checking availability…')).toBeInTheDocument()
    await user.click(sparkasseRow)
    expect(screen.queryByRole('heading', { name: /Find your Sparkasse branch/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Cards' }))
    await user.click(screen.getByRole('button', { name: /Kreditkarte manuell/ }))
    expect(screen.getByRole('heading', { name: 'Add manual account' })).toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()
  })

  it('shows a retryable error banner and blocks every external provider when status fails to load, never falling back to optimistic availability', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockRejectedValueOnce(new Error('network down'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/couldn.t check which providers are available/)
    const paypalRow = screen.getByRole('button', { name: /^PayPal/ })
    expect(paypalRow).toBeDisabled()
    expect(within(paypalRow).getByText('Availability could not be checked.')).toBeInTheDocument()
    await user.click(paypalRow)
    expect(screen.queryByRole('heading', { name: /Continue to PayPal|Continue with the owner PayPal connection/ })).not.toBeInTheDocument()
  })

  it('recovers via the explicit Retry action once provider status succeeds', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockRejectedValueOnce(new Error('network down'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    const paypalRow = await screen.findByRole('button', { name: /^PayPal$/ })
    await waitFor(() => expect(paypalRow).not.toBeDisabled())
    await user.click(paypalRow)
    expect(screen.getByRole('heading', { name: 'Continue with the owner PayPal connection' })).toBeInTheDocument()
  })

  it('commits only the most recently issued provider-status call, even if an earlier call settles later (stale-response race)', async () => {
    // The Retry button can't actually be double-clicked through the UI --
    // it only renders while status === 'error', so the first click flips to
    // 'loading' and the button unmounts before a second click could land.
    // This test bypasses that UI gate entirely (two synchronous fireEvent
    // dispatches inside one act(), before React flushes the first click's
    // resulting re-render) to exercise the actual double-dispatch boundary
    // the generation counter is meant to protect: two overlapping
    // loadProviderStatus() calls settling out of issue-order.
    let resolveEarlier!: (value: ProviderDescriptor[]) => void
    let rejectLater!: (reason: Error) => void
    vi.mocked(fetchProviderStatus)
      .mockRejectedValueOnce(new Error('network down')) // initial mount-time fetch, so the Retry button exists to grab a reference to
      .mockImplementationOnce(() => new Promise((resolve) => { resolveEarlier = resolve })) // 1st retry dispatch (generation N) -- will resolve with SUCCESS, but late
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLater = reject })) // 2nd retry dispatch (generation N+1) -- will fail, but settles first
    renderConnections()
    fireEvent.click(screen.getByRole('button', { name: 'Connect an account' }))
    const retryButton = await screen.findByRole('button', { name: 'Retry' })

    await act(async () => {
      fireEvent.click(retryButton)
      fireEvent.click(retryButton)
    })

    // Later-issued call (generation N+1) settles first, with an error.
    await act(async () => { rejectLater(new Error('network down again')) })
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    // Earlier-issued call (generation N) settles after it, with success -- it
    // must be a no-op: the error state from the later call must stand.
    await act(async () => { resolveEarlier(DEFAULT_PROVIDER_STATUS) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('fails closed for an AIS institution when both Enable Banking and GoCardless are missing from an otherwise-successful response, never defaulting it to available', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.filter((provider) => provider.id !== 'gocardless' && provider.id !== 'enablebanking'))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    const ingRow = await screen.findByRole('button', { name: /^ING/ })
    await waitFor(() => expect(ingRow).toBeDisabled())
    expect(within(ingRow).getByText('Bank connections are not available right now.')).toBeInTheDocument()
  })
})

describe('PayPal owner-mode authorization reaching the frontend (defect: not user-specific)', () => {
  it('disables PayPal in the picker for a non-owner user and never reaches startConnector', async () => {
    const user = userEvent.setup()
    vi.mocked(fetchProviderStatus).mockResolvedValueOnce(DEFAULT_PROVIDER_STATUS.map((provider) => (provider.id === 'paypal'
      ? { ...provider, available: false, reason: 'This PayPal owner connection is not available for this user.' }
      : provider)))
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    const paypalRow = await screen.findByRole('button', { name: /^PayPal/ })
    await waitFor(() => expect(paypalRow).toBeDisabled())
    expect(within(paypalRow).getByText('This PayPal owner connection is not available for this user.')).toBeInTheDocument()
    await user.click(paypalRow)
    expect(screen.queryByRole('heading', { name: /Continue to PayPal|Continue with the owner PayPal connection/ })).not.toBeInTheDocument()
    expect(startConnector).not.toHaveBeenCalled()
  })

  it('leaves PayPal selectable and reaching startConnector for the owner user', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    const paypalRow = await screen.findByRole('button', { name: /^PayPal$/ })
    await waitFor(() => expect(paypalRow).not.toBeDisabled())
    await user.click(paypalRow)
    await user.click(screen.getByRole('button', { name: 'Continue with owner connection' }))
    expect(startConnector).toHaveBeenCalledWith('paypal', { institutionId: 'paypal', institutionName: 'PayPal', accountType: 'checking' })
  })
})

describe('provider callback handling', () => {
  it('strips callback parameters from the URL and checks the connection before showing results (real GoCardless success-redirect shape: ?provider= alone, no code/state)', async () => {
    window.history.pushState({}, '', '/?provider=gocardless')
    let resolveSync!: (value: Awaited<ReturnType<typeof synchronizeConnections>>) => void
    ;(synchronizeConnections as Mock).mockImplementation(() => new Promise((resolve) => { resolveSync = resolve }))
    renderConnections()
    expect(window.location.search).toBe('')
    expect(screen.getByRole('heading', { name: 'Checking your connection' })).toBeInTheDocument()
    resolveSync([])
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Checking your connection' })).not.toBeInTheDocument())
    expect(synchronizeConnections).toHaveBeenCalledTimes(1)
  })

  it('triggers synchronize for a PayPal callback return with only ?provider= present, proving the fix closes the gap rather than just moving it', async () => {
    window.history.pushState({}, '', '/?provider=paypal')
    let resolveSync!: (value: Awaited<ReturnType<typeof synchronizeConnections>>) => void
    ;(synchronizeConnections as Mock).mockImplementation(() => new Promise((resolve) => { resolveSync = resolve }))
    renderConnections()
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

  // Design review, 2026-08-27: a reconnect's stableId-matched account
  // reconciliation (see buildSyncPreview() in connectors.ts) is safe but
  // silent -- without a visible cue, a user reconnecting a bank sees their
  // own existing account re-listed with no way to tell it isn't a
  // duplicate. The sync-selection screen now labels a reconnect-matched row
  // distinctly from a genuinely new account.
  it('labels a reconnect-matched account distinctly from a genuinely new one, so the reconciliation is never a silent surprise', async () => {
    window.history.pushState({}, '', '/?provider=enablebanking')
    const existingAccountId = 'connector:enablebanking:old-session-uid'
    const stateWithExistingAccount: AppState = {
      accounts: [{ id: existingAccountId, externalId: 'old-session-uid', stableId: 'a'.repeat(64), name: 'Girokonto', type: 'checking', balanceCents: 100_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }
    ;(synchronizeConnections as Mock).mockResolvedValueOnce([{
      connection: { id: 'enablebanking', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected' },
      accounts: [{ externalId: 'new-session-uid', stableId: 'a'.repeat(64), name: 'Girokonto', type: 'checking', balanceCents: 150_000, currency: 'EUR' }],
      transactions: [],
    }])

    renderConnections({ state: stateWithExistingAccount })
    await waitFor(() => expect(screen.getByText('Choose accounts')).toBeInTheDocument())
    expect(screen.getByText('Already in Finance Planner — refreshing balance')).toBeInTheDocument()
    expect(screen.queryByText('Checking', { selector: 'small' })).not.toBeInTheDocument()
  })
})

describe('connection attention, reconnect and disconnect', () => {
  it('shows the attention reason and lets the user reconnect with the originally-selected institution, not an empty context', async () => {
    const user = userEvent.setup()
    renderConnections({ acceptanceMode: 'attention' })
    expect(screen.getByRole('heading', { name: 'Connection needs attention' })).toBeInTheDocument()
    expect(screen.getByText('Provider error')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Reconnect/ }))
    // Regression: reconnect used to pass an empty context, which
    // GoCardless's server-validated start() now correctly rejects with
    // institution_required -- the stored institutionId must be resubmitted.
    expect(startConnector).toHaveBeenCalledWith('finapi', { institutionId: 'DEUTSCHE_BANK_DEUTDEFF' })
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

  it('tells the user honestly when the local disconnect succeeded but the provider could not confirm revocation', async () => {
    const user = userEvent.setup()
    vi.mocked(disconnectConnector).mockResolvedValueOnce({ disconnected: true, providerRevoked: false, providerRevokeReason: 'provider_error' })
    renderConnections({ acceptanceMode: 'attention' })
    await user.click(screen.getByRole('button', { name: /^Disconnect$/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    expect(await screen.findByText(/couldn't confirm the provider revoked access/)).toBeInTheDocument()
  })

  it('lets a healthy connection be opened and disconnected too, not only a broken one', async () => {
    // Regression: healthy rows previously rendered as an inert <div> with no
    // click handler at all -- there was no way to reach Disconnect for a
    // working connection anywhere in the UI.
    const user = userEvent.setup()
    renderConnections({ acceptanceMode: 'populated' })
    await user.click(screen.getByRole('button', { name: /Sparkasse/ }))
    expect(screen.getByRole('heading', { name: 'Manage connection' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Connection needs attention' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Disconnect$/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Disconnect$/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    expect(disconnectConnector).toHaveBeenCalledWith('gocardless')
  })

  it('reconnects a healthy connection with its stored institutionId from the manage screen too', async () => {
    const user = userEvent.setup()
    renderConnections({ acceptanceMode: 'populated' })
    await user.click(screen.getByRole('button', { name: /Sparkasse/ }))
    await user.click(screen.getByRole('button', { name: /Reconnect/ }))
    expect(startConnector).toHaveBeenCalledWith('gocardless', { institutionId: 'SPARKASSE_AACHEN_AACSDE33' })
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

// Fixed 2026-08-27 (PR #154, seventh Mock ASPSP pass): `connections` was
// plain React state, destroyed on unmount -- navigating away and back made
// a genuinely still-connected "Bank connection / Connected" card disappear
// even though nothing was ever disconnected server-side. Fixed with a
// dedicated GET /api/connectors/connections mount fetch, independent of
// provider-status loading and never triggering a provider sync merely to
// list what's already stored.
describe('persisted connections survive page remount (defect: connection disappears on navigation)', () => {
  const STORED_ENABLEBANKING: ConnectorConnection = { id: 'enablebanking', provider: 'enablebanking', displayName: 'Bank connection', status: 'connected', lastSyncAt: '2026-08-26T14:19:00.000Z' }

  it('a stored connection appears on a fresh mount, without any provider sync being triggered', async () => {
    ;(fetchStoredConnections as Mock).mockResolvedValueOnce([STORED_ENABLEBANKING])
    renderConnections()
    await waitFor(() => expect(screen.getByText('Bank connection')).toBeInTheDocument())
    expect(screen.getAllByText('Connected').length).toBeGreaterThan(0)
    expect(synchronizeConnections).not.toHaveBeenCalled()
  })

  it('navigating away (unmount) and back (remount) still shows the connection', async () => {
    ;(fetchStoredConnections as Mock).mockResolvedValue([STORED_ENABLEBANKING])
    const first = renderConnections()
    await waitFor(() => expect(screen.getByText('Bank connection')).toBeInTheDocument())
    first.unmount()

    renderConnections()
    await waitFor(() => expect(screen.getByText('Bank connection')).toBeInTheDocument())
  })

  it('no stored connection -> the normal empty state, not an error', async () => {
    ;(fetchStoredConnections as Mock).mockResolvedValueOnce([])
    renderConnections()
    await waitFor(() => expect(fetchStoredConnections).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Connect your financial accounts' })).toBeInTheDocument()
    expect(screen.queryByText('Bank connection')).not.toBeInTheDocument()
  })

  it('a failed stored-connections request does not crash the page and leaves the normal empty state (never erases a connection it never had)', async () => {
    ;(fetchStoredConnections as Mock).mockRejectedValueOnce(new Error('network error'))
    renderConnections()
    await waitFor(() => expect(fetchStoredConnections).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Connect your financial accounts' })).toBeInTheDocument()
  })

  // Found by adversarial review (2026-08-27): listStoredConnections()
  // awaits each provider's stored row sequentially server-side, so the
  // mount-time fetchStoredConnections() request can still be in flight when
  // the user disconnects a connection that a FASTER synchronize() call
  // already surfaced. Without tracking this, the slow fetch resolving
  // afterward with its now-stale pre-disconnect snapshot would resurrect a
  // connection in the UI that was genuinely just deleted server-side.
  it('a disconnect completing before the mount-time stored-connections fetch resolves is not undone when that stale fetch finally lands', async () => {
    window.history.pushState({}, '', '/?provider=enablebanking')
    let resolveStored!: (value: ConnectorConnection[]) => void
    ;(fetchStoredConnections as Mock).mockImplementation(() => new Promise((resolve) => { resolveStored = resolve }))
    ;(synchronizeConnections as Mock).mockResolvedValueOnce([{ connection: STORED_ENABLEBANKING, accounts: [], transactions: [] }])
    ;(disconnectConnector as Mock).mockResolvedValueOnce({ disconnected: true, providerRevoked: true, providerRevokeReason: 'confirmed' })

    renderConnections()
    await waitFor(() => expect(screen.getByText('Bank connection')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByText('Bank connection').closest('button')!)
    await user.click(screen.getByRole('button', { name: /^Disconnect$/ }))
    await user.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    await waitFor(() => expect(disconnectConnector).toHaveBeenCalledWith('enablebanking'))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Connect your financial accounts' })).toBeInTheDocument())

    // The slow mount-time fetch (issued before the disconnect) now resolves
    // with the stale, still-connected snapshot -- it must not resurrect it.
    resolveStored([STORED_ENABLEBANKING])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByRole('heading', { name: 'Connect your financial accounts' })).toBeInTheDocument()
    expect(screen.queryByText('Bank connection')).not.toBeInTheDocument()
  })

  it('a fresher post-sync connection result is never clobbered by a slower, now-stale stored-connections fetch resolving after it', async () => {
    window.history.pushState({}, '', '/?provider=enablebanking')
    let resolveStored!: (value: ConnectorConnection[]) => void
    ;(fetchStoredConnections as Mock).mockImplementation(() => new Promise((resolve) => { resolveStored = resolve }))
    ;(synchronizeConnections as Mock).mockResolvedValueOnce([{ connection: { ...STORED_ENABLEBANKING, lastSyncAt: '2026-08-27T09:00:00.000Z' }, accounts: [], transactions: [] }])

    renderConnections()
    // synchronize() (triggered by the ?provider= callback-return effect)
    // resolves on its own microtask queue; wait for its result to land.
    await waitFor(() => expect(screen.getByText('Bank connection')).toBeInTheDocument())

    // The stored-connections fetch (issued at mount, in parallel) resolves
    // LATE, with a stale pre-sync snapshot -- it must not overwrite the
    // fresher post-sync connection state that's already showing.
    resolveStored([{ ...STORED_ENABLEBANKING, lastSyncAt: '2026-08-20T00:00:00.000Z' }])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.getByText('Bank connection')).toBeInTheDocument()
  })
})
