import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { AppState } from '../../types'
import { ConnectionsPage } from './ConnectionsPage'

vi.mock('../../connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../connectors')>()
  return { ...actual, startConnector: vi.fn(async () => {}), synchronizeConnections: vi.fn(async () => []), disconnectConnector: vi.fn(async () => {}) }
})

import { disconnectConnector, startConnector, synchronizeConnections } from '../../connectors'

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

describe('setup step transitions and account-type selection', () => {
  it('sends account-type-required institutions to step 2 with a sensible default selected', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(screen.getByRole('button', { name: /Trade Republic/ }))
    expect(screen.getByRole('heading', { name: 'What would you like to connect?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Investment account/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('sends institutions without a required account type straight to confirmation', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /Sparkasse/ }))
    expect(screen.getByRole('heading', { name: 'Continue to your provider' })).toBeInTheDocument()
  })

  it('selecting an account type advances to the confirmation step', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(screen.getByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Checking account/ }))
    expect(screen.getByRole('heading', { name: 'Continue to your provider' })).toBeInTheDocument()
  })
})

describe('redirect confirmation', () => {
  it('requires explicit confirmation before starting a bank connector, with the correct provider and context', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('tab', { name: 'Investments' }))
    await user.click(screen.getByRole('button', { name: /Trade Republic/ }))
    await user.click(screen.getByRole('radio', { name: /Investment account/ }))
    expect(startConnector).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Continue securely' }))
    expect(startConnector).toHaveBeenCalledWith('finapi', { institutionId: 'trade-republic', institutionName: 'Trade Republic', accountType: 'investment' })
  })

  it('uses distinct PayPal confirmation copy and starts the paypal provider', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /^PayPal$/ }))
    expect(screen.getByRole('heading', { name: 'Continue to PayPal' })).toBeInTheDocument()
    expect(screen.getByText(/Finance Planner does not receive your PayPal password/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Continue to PayPal' }))
    expect(startConnector).toHaveBeenCalledWith('paypal', { institutionId: 'paypal', institutionName: 'PayPal', accountType: 'checking' })
  })

  it('Cancel does not start a provider', async () => {
    const user = userEvent.setup()
    renderConnections()
    await user.click(screen.getByRole('button', { name: 'Connect an account' }))
    await user.click(screen.getByRole('button', { name: /Sparkasse/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(startConnector).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Continue to your provider' })).not.toBeInTheDocument()
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
    const [nextState] = onApply.mock.calls[0]
    expect(nextState.accounts[0]).toMatchObject({ name: 'Everyday credit card', type: 'credit-card', balanceCents: -25_075 })
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
