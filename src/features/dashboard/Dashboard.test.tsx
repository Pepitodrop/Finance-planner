import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, AppState } from '../../types'
import { Dashboard } from './Dashboard'

type RemoveAccountResult = { ok: true } | { ok: false; error: string }
type RemoveAccountFn = (account: Account) => Promise<RemoveAccountResult>

const populatedState: AppState = {
  accounts: [{ id: 'account', name: 'An account name deliberately long enough to truncate safely', type: 'checking', balanceCents: 12_345_678, currency: 'EUR' }],
  transactions: [
    { id: 'income', accountId: 'account', description: 'Consulting payment with a deliberately long description', category: 'Income', type: 'income', amountCents: 300_000, date: '2026-08-03' },
    { id: 'expense', accountId: 'account', description: 'Groceries', category: 'Food', type: 'expense', amountCents: 45_000, date: '2026-08-02' },
  ],
  goals: [{ id: 'goal', name: 'Emergency fund', targetCents: 1_000_000, currentCents: 500_000, targetDate: '2027-01-01' }],
}

function renderDashboard(state = populatedState, onRemoveAccountOverride?: RemoveAccountFn, onRemoveLegacyAccountLocallyOverride?: RemoveAccountFn) {
  const onAddTransaction = vi.fn()
  const onEditTransaction = vi.fn()
  const onNavigate = vi.fn()
  const onRemoveAccount = onRemoveAccountOverride ?? vi.fn(async () => ({ ok: true as const }))
  const onRemoveLegacyAccountLocally = onRemoveLegacyAccountLocallyOverride ?? vi.fn(async () => ({ ok: true as const }))
  render(<Dashboard
    state={state}
    userName="Alex Rivera"
    onAddTransaction={onAddTransaction}
    onEditTransaction={onEditTransaction}
    onNavigate={onNavigate}
    onRemoveAccount={onRemoveAccount}
    onRemoveLegacyAccountLocally={onRemoveLegacyAccountLocally}
    referenceDate={new Date(2026, 7, 4, 19)}
  />)
  return { onAddTransaction, onEditTransaction, onNavigate, onRemoveAccount, onRemoveLegacyAccountLocally }
}

describe('Dashboard', () => {
  afterEach(cleanup)

  it('declares an English language boundary for the redesigned feature', () => {
    renderDashboard()
    expect(document.querySelector('[data-dashboard-ready="true"]')).toHaveAttribute('lang', 'en')
  })

  it('renders canonical English structure and genuine summary values without fabricated trends', () => {
    renderDashboard()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('Welcome back, Alex. Here is your financial overview.')).toBeInTheDocument()
    expect(screen.getByText('August 2026')).toBeInTheDocument()
    expect(screen.getByText('Income').closest('article')).toHaveTextContent('+3.000,00 €')
    expect(screen.getByText('Expenses').closest('article')).toHaveTextContent('−450,00 €')
    expect(screen.getByText('Surplus').closest('article')).toHaveTextContent('+2.550,00 €')
    expect(screen.queryByText(/last month|versus|vs\.|trend/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Finanzübersicht|Gesamtvermögen|Sparziele/)).not.toBeInTheDocument()
  })

  it('labels projection semantics and exposes a textual alternative', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: 'Balance projection' })).toBeInTheDocument()
    expect(screen.getByText('Next 12 months')).toBeInTheDocument()
    expect(screen.getByText(/starts with your current account balance/i)).toBeInTheDocument()
    expect(screen.getByText(/It is not historical or investment performance/i)).toBeInTheDocument()
    expect(screen.getByText(/The projected balance after 12 months/i)).toBeInTheDocument()
  })

  it('renders account, goal, category, and recent-transaction previews from state', () => {
    renderDashboard()
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(screen.getAllByText(/An account name deliberately long/).length).toBeGreaterThan(0)
    expect(screen.getByRole('progressbar', { name: 'Emergency fund: 50% saved' })).toHaveAttribute('aria-valuenow', '50')
    const categorySection = screen.getByRole('heading', { name: 'Expenses by category' }).closest('article')
    expect(categorySection).not.toBeNull()
    expect(within(categorySection!).getByText('Food')).toBeInTheDocument()
    expect(categorySection).toHaveTextContent('Current-month category total 450,00 €')
    expect(screen.getByRole('button', { name: /Edit Consulting payment/ })).toBeInTheDocument()
  })

  it('keeps Add transaction and genuine destination actions functional', async () => {
    const user = userEvent.setup()
    const { onAddTransaction, onNavigate } = renderDashboard()
    await user.click(within(document.querySelector('.dashboard-toolbar')!).getByRole('button', { name: 'Add transaction' }))
    expect(onAddTransaction).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'View all' }))
    expect(onNavigate).toHaveBeenCalledWith('transactions')
    await user.click(screen.getByRole('button', { name: 'Manage goals' }))
    expect(onNavigate).toHaveBeenCalledWith('goals')
  })

  it('renders meaningful empty states without dead Accounts navigation', async () => {
    const user = userEvent.setup()
    const { onAddTransaction, onNavigate } = renderDashboard({ accounts: [], transactions: [], goals: [] })
    expect(screen.getByText('No accounts recorded')).toBeInTheDocument()
    expect(screen.getByText('No savings goals yet')).toBeInTheDocument()
    expect(screen.getByText('No transactions yet')).toBeInTheDocument()
    expect(screen.getByText('No expenses this month')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /View all accounts/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Connections' }))
    expect(onNavigate).toHaveBeenCalledWith('connections')
    await user.click(within(document.querySelector('.dashboard-toolbar')!).getByRole('button', { name: 'Add transaction' }))
    expect(onAddTransaction).toHaveBeenCalledOnce()
  })

  // "Remove account" (2026-08-27, PR #154): a manual account's row exposes
  // a discreet, accessibly-named action that opens a confirmation dialog --
  // never a single unconfirmed click. See src/accountState.ts for the
  // domain logic these UI tests wire into.
  describe('Remove account', () => {
    const manualState: AppState = {
      accounts: [{ id: 'manual-account', name: 'Bargeld', type: 'cash', balanceCents: 10_000, currency: 'EUR' }],
      transactions: [
        { id: 'tx-1', accountId: 'manual-account', description: 'Kaffee', category: 'Sonstiges', type: 'expense', amountCents: 350, date: '2026-08-01' },
        { id: 'tx-2', accountId: 'manual-account', description: 'Trinkgeld', category: 'Sonstiges', type: 'expense', amountCents: 200, date: '2026-08-02' },
      ],
      goals: [],
    }
    const providerState: AppState = {
      accounts: [{ id: 'connector:enablebanking:acct-1', externalId: 'acct-1', stableId: 'a'.repeat(64), name: 'Girokonto', type: 'checking', balanceCents: 50_000, currency: 'EUR' }],
      transactions: [],
      goals: [],
    }

    it('exposes an accessibly-named action for each account row', () => {
      renderDashboard(manualState)
      expect(screen.getByRole('button', { name: 'Actions for Bargeld' })).toBeInTheDocument()
    })

    it('clicking the action opens a confirmation dialog naming the account and the exact transaction count, without removing anything yet', async () => {
      const user = userEvent.setup()
      const { onRemoveAccount } = renderDashboard(manualState)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      const dialog = screen.getByRole('dialog', { name: 'Remove "Bargeld"?' })
      expect(dialog).toHaveTextContent('This account has 2 transactions. Removing the account will also remove those 2 transactions.')
      expect(onRemoveAccount).not.toHaveBeenCalled()
    })

    it('Cancel closes the dialog without calling onRemoveAccount', async () => {
      const user = userEvent.setup()
      const { onRemoveAccount } = renderDashboard(manualState)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(onRemoveAccount).not.toHaveBeenCalled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('confirming calls onRemoveAccount with the full account exactly once, and closes the dialog on success', async () => {
      const user = userEvent.setup()
      const { onRemoveAccount } = renderDashboard(manualState)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove account' }))
      await waitFor(() => expect(onRemoveAccount).toHaveBeenCalledTimes(1))
      expect(onRemoveAccount).toHaveBeenCalledWith(manualState.accounts[0])
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('shows the removing-in-progress state and disables duplicate submissions while the request is running', async () => {
      const user = userEvent.setup()
      let resolveRemoval!: (value: { ok: true }) => void
      const onRemoveAccount = vi.fn(() => new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => { resolveRemoval = resolve }))
      renderDashboard(manualState, onRemoveAccount)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove account' }))
      expect(await screen.findByRole('button', { name: 'Removing account…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
      expect(onRemoveAccount).toHaveBeenCalledTimes(1)

      resolveRemoval({ ok: true })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    // Found by adversarial review (2026-08-27): ConfirmationDialog's Escape
    // handler and backdrop click call onClose unconditionally -- only the
    // buttons themselves check `busy`. Without a guard, dismissing the
    // dialog while removal is in flight would close it early; if that
    // call later fails, the resulting error would fire into an
    // already-closed dialog and be silently lost.
    it('Escape does not close the dialog while a removal is in flight, so a later failure is never silently lost', async () => {
      const user = userEvent.setup()
      let resolveRemoval!: (value: { ok: false; error: string }) => void
      const onRemoveAccount = vi.fn(() => new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => { resolveRemoval = resolve }))
      renderDashboard(manualState, onRemoveAccount)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove account' }))
      await screen.findByRole('button', { name: 'Removing account…' })

      await user.keyboard('{Escape}')
      expect(screen.getByRole('dialog')).toBeInTheDocument()

      resolveRemoval({ ok: false, error: 'The account could not be removed.' })
      expect(await screen.findByRole('alert')).toHaveTextContent('The account could not be removed.')
    })

    it('on failure, keeps the account visible, shows an actionable error, and lets the user retry', async () => {
      const user = userEvent.setup()
      const onRemoveAccount = vi.fn()
        .mockResolvedValueOnce({ ok: false, error: 'The account could not be removed. Please try again.' })
        .mockResolvedValueOnce({ ok: true })
      renderDashboard(manualState, onRemoveAccount)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove account' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('The account could not be removed. Please try again. You can try again or cancel.')
      // Dialog stays open, account was never removed from the row list.
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Bargeld')).toBeInTheDocument()

      // Retry: clicking Remove account again re-attempts the same operation.
      await user.click(screen.getByRole('button', { name: 'Remove account' }))
      expect(onRemoveAccount).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('a zero-transaction account shows honest copy, never a false "1 transaction" claim', async () => {
      const user = userEvent.setup()
      const emptyState: AppState = { ...manualState, transactions: [] }
      renderDashboard(emptyState)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      expect(screen.getByRole('dialog')).toHaveTextContent('This account has no recorded transactions.')
    })

    it('a provider-linked account additionally explains the bank connection stays active and the account will not be re-imported', async () => {
      const user = userEvent.setup()
      renderDashboard(providerState)
      await user.click(screen.getByRole('button', { name: 'Actions for Girokonto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveTextContent('the bank connection itself will remain active')
      expect(dialog).toHaveTextContent('will not be automatically re-imported')
    })

    it('a manual account does NOT show the provider-connection caveat', async () => {
      const user = userEvent.setup()
      renderDashboard(manualState)
      await user.click(screen.getByRole('button', { name: 'Actions for Bargeld' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      expect(screen.getByRole('dialog')).not.toHaveTextContent('bank connection')
    })

    // Fail-conservative (independent review, BLOCKER 2), REVISED by a
    // fourth independent review (2026-08-27): a provider account with no
    // stableId still never gets the STRONG durable-exclusion removal
    // (onRemoveAccount is never called for it), but it is no longer a dead
    // end -- see the "legacy provider account (no stableId)" describe
    // block below for the new local-only removal path this account now
    // qualifies for instead.
    it('a provider account with no stableId never calls the durable-exclusion onRemoveAccount, and can still navigate to Connections to disconnect instead', async () => {
      const user = userEvent.setup()
      const noStableIdState: AppState = {
        accounts: [{ id: 'connector:enablebanking:acct-2', externalId: 'acct-2', name: 'Sparkonto', type: 'savings', balanceCents: 20_000, currency: 'EUR' }],
        transactions: [],
        goals: [],
      }
      const { onRemoveAccount, onNavigate } = renderDashboard(noStableIdState)
      await user.click(screen.getByRole('button', { name: 'Actions for Sparkonto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      expect(screen.queryByRole('button', { name: 'Remove account' })).not.toBeInTheDocument()
      expect(onRemoveAccount).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: /Go to Connections/ }))
      expect(onNavigate).toHaveBeenCalledWith('connections')
      expect(onRemoveAccount).not.toHaveBeenCalled()
    })
  })

  // BLOCKER 2 (fourth independent review, 2026-08-27): a provider-linked
  // account with no stableId -- e.g. one imported before stableId existed,
  // or the exact duplicate an earlier PR #154 head's reconnect bug created
  // -- was previously permanently undeletable from the Dashboard. This
  // suite covers the new, explicitly-weaker LOCAL-ONLY removal path: it
  // must never be confused with (or silently upgrade into) the durable
  // exclusion-first path covered above.
  describe('Remove legacy account (no stableId, local-only)', () => {
    const legacyState: AppState = {
      accounts: [{ id: 'connector:enablebanking:old-session-uid', externalId: 'old-session-uid', name: 'Altes Konto', type: 'checking', balanceCents: 30_000, currency: 'EUR' }],
      transactions: [
        { id: 'connector:enablebanking:hist-1', accountId: 'connector:enablebanking:old-session-uid', description: 'Miete', category: 'Wohnen', type: 'expense', amountCents: 80_000, date: '2026-07-01' },
      ],
      goals: [],
    }

    it('offers "Remove local copy" instead of the durable "Remove account" action', async () => {
      const user = userEvent.setup()
      renderDashboard(legacyState)
      await user.click(screen.getByRole('button', { name: 'Actions for Altes Konto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      expect(screen.getByRole('button', { name: 'Remove local copy' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove account' })).not.toBeInTheDocument()
    })

    // Item 4 from the review: the confirmation must clearly say suppression
    // cannot be guaranteed, never implying the same durability the modern
    // (stableId) removal path promises.
    it('the confirmation copy clearly states provider suppression cannot be guaranteed, never claiming durable exclusion', async () => {
      const user = userEvent.setup()
      renderDashboard(legacyState)
      await user.click(screen.getByRole('button', { name: 'Actions for Altes Konto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      const dialog = screen.getByRole('dialog')
      expect(dialog).toHaveTextContent('does not contain a stable bank identifier')
      expect(dialog).toHaveTextContent('cannot guarantee the bank will not return it again')
      expect(dialog).not.toHaveTextContent('will not be automatically re-imported')
    })

    it('confirming calls onRemoveLegacyAccountLocally (never onRemoveAccount) with the full account exactly once, and closes on success', async () => {
      const user = userEvent.setup()
      const { onRemoveAccount, onRemoveLegacyAccountLocally } = renderDashboard(legacyState)
      await user.click(screen.getByRole('button', { name: 'Actions for Altes Konto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove local copy' }))
      await waitFor(() => expect(onRemoveLegacyAccountLocally).toHaveBeenCalledTimes(1))
      expect(onRemoveLegacyAccountLocally).toHaveBeenCalledWith(legacyState.accounts[0])
      expect(onRemoveAccount).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('on failure, keeps the account visible, shows an actionable error, and lets the user retry', async () => {
      const user = userEvent.setup()
      const onRemoveLegacyAccountLocally = vi.fn()
        .mockResolvedValueOnce({ ok: false, error: 'The account could not be removed. Please try again.' })
        .mockResolvedValueOnce({ ok: true })
      renderDashboard(legacyState, undefined, onRemoveLegacyAccountLocally)
      await user.click(screen.getByRole('button', { name: 'Actions for Altes Konto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove local copy' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('The account could not be removed. Please try again. You can try again or cancel.')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText('Altes Konto')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Remove local copy' }))
      expect(onRemoveLegacyAccountLocally).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('shows a busy state and disables Cancel/Go-to-Connections while the request is running', async () => {
      const user = userEvent.setup()
      let resolveRemoval!: (value: { ok: true }) => void
      const onRemoveLegacyAccountLocally = vi.fn(() => new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => { resolveRemoval = resolve }))
      renderDashboard(legacyState, undefined, onRemoveLegacyAccountLocally)
      await user.click(screen.getByRole('button', { name: 'Actions for Altes Konto' }))
      await user.click(screen.getByRole('menuitem', { name: /Remove account/ }))
      await user.click(screen.getByRole('button', { name: 'Remove local copy' }))
      expect(await screen.findByRole('button', { name: 'Removing…' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

      resolveRemoval({ ok: true })
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })
  })
})
