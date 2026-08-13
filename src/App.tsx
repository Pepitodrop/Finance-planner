import { useEffect, useMemo, useState } from 'react'
import { Plus, Undo2 } from 'lucide-react'
import { AccountPage } from './AccountPage'
import { AiPanel, type AiPanelAcceptanceMode } from './AiPanel'
import type { AiSuggestion } from './ai'
import type { AuthUser } from './AuthGate'
import { learnBehavior } from './behavior'
import { ConnectionsPanel } from './ConnectionsPanel'
import type { ConnectionsAcceptanceMode } from './features/connections/connectionsAcceptanceFixtures'
import { DataTools, type DataToolsAcceptanceMode } from './DataTools'
import { accountsAcceptanceState, initialState, planningAcceptanceState } from './data'
import { FinanceAssistant, type AssistantAcceptanceMode } from './FinanceAssistant'
import { ReceiptReview, type ReceiptAcceptanceMode } from './ReceiptReview'
import { SavingsGoals } from './SavingsGoals'
import { TransactionsPage } from './TransactionsPage'
import { Dashboard } from './features/dashboard/Dashboard'
import { AccountsPage } from './features/accounts/AccountsPage'
import { RecurringPaymentsPage } from './features/recurring/RecurringPaymentsPage'
import { SubscriptionsPage, type SubscriptionsAcceptanceMode } from './features/subscriptions/SubscriptionsPage'
import { loadState, resetStoredState, saveState } from './storage'
import { addTransactionToState, deleteTransactionFromState, updateTransactionInState } from './transactionState'
import type { AppState, Transaction, TransactionType } from './types'
import { validateTransactionInput } from './validation'
import { ApplicationShell } from './app/ApplicationShell'
import type { DestinationId } from './app/navigation'

interface AppProps { userId: string; userName?: string; user: AuthUser; onLockVault?: () => void; onLogout: () => Promise<void> }

const CONNECTIONS_ACCEPTANCE_MODES: ConnectionsAcceptanceMode[] = ['empty', 'populated', 'institution-selector', 'institution-search', 'provider-unavailable', 'account-type', 'bank-confirmation', 'paypal-confirmation', 'checking', 'sync-selection', 'attention', 'manual', 'statement-preview']
const AI_ACCEPTANCE_MODES: AiPanelAcceptanceMode[] = ['ready', 'progress', 'results', 'anomaly', 'applied', 'error', 'empty']
const ASSISTANT_ACCEPTANCE_MODES: AssistantAcceptanceMode[] = ['hosted-consent', 'hosted-running', 'success', 'hosted-fallback', 'local-selected', 'local-running']
const RECEIPT_ACCEPTANCE_MODES: ReceiptAcceptanceMode[] = ['selected', 'running', 'sufficient', 'insufficient', 'receipt-error']
const DATA_ACCEPTANCE_MODES: DataToolsAcceptanceMode[] = ['overview', 'vault-password', 'create-backup', 'restore-backup', 'restore-failure', 'reset', 'reset-complete', 'csv-warning', 'delete-account', 'delete-account-final', 'delete-failure', 'cloud-sync', 'sync-offline', 'sync-error']
const SUBSCRIPTIONS_ACCEPTANCE_MODES: SubscriptionsAcceptanceMode[] = ['intro', 'preflight', 'connected', 'syncing', 'no-subscriptions', 'unavailable', 'subscription-sync-error', 'manage']

function App({ userId, userName, user, onLockVault, onLogout }: AppProps) {
  const [state, setState] = useState<AppState>(() => loadState())
  const [tab, setTab] = useState<DestinationId>(() =>
    typeof window !== 'undefined' && window.location.search.includes('provider=google-subscriptions') ? 'subscriptions' : 'dashboard')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [transactionType, setTransactionType] = useState<TransactionType>('expense')
  const [formError, setFormError] = useState('')
  const [deletedTransaction, setDeletedTransaction] = useState<Transaction | null>(null)
  const [requestedTransactionAccount, setRequestedTransactionAccount] = useState<string | null>(null)
  const [accountsAcceptanceMode, setAccountsAcceptanceMode] = useState<'accounts' | 'empty' | 'detail' | 'credit' | null>(null)
  const [planningAcceptanceMode, setPlanningAcceptanceMode] = useState<'goals' | 'goals-empty' | 'goal-editor' | 'recurring' | 'recurring-empty' | 'budget-consent' | 'budget-result' | null>(null)
  const [connectionsAcceptanceMode, setConnectionsAcceptanceMode] = useState<ConnectionsAcceptanceMode | null>(null)
  const [aiAcceptanceMode, setAiAcceptanceMode] = useState<AiPanelAcceptanceMode | null>(null)
  const [assistantAcceptanceMode, setAssistantAcceptanceMode] = useState<AssistantAcceptanceMode | null>(null)
  const [receiptAcceptanceMode, setReceiptAcceptanceMode] = useState<ReceiptAcceptanceMode | null>(null)
  const [dataAcceptanceMode, setDataAcceptanceMode] = useState<DataToolsAcceptanceMode | null>(null)
  const [subscriptionsAcceptanceMode, setSubscriptionsAcceptanceMode] = useState<SubscriptionsAcceptanceMode | null>(null)

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    if (import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true') return
    const target = window as Window & { __financePlannerAcceptanceState?: (mode: string) => void }
    target.__financePlannerAcceptanceState = (mode) => {
      if (['accounts','empty','detail','credit'].includes(mode)) setAccountsAcceptanceMode(mode as 'accounts' | 'empty' | 'detail' | 'credit')
      if (['goals','goals-empty','goal-editor','recurring','recurring-empty','budget-consent','budget-result'].includes(mode)) setPlanningAcceptanceMode(mode as typeof planningAcceptanceMode)
      if (CONNECTIONS_ACCEPTANCE_MODES.includes(mode as ConnectionsAcceptanceMode)) setConnectionsAcceptanceMode(mode as ConnectionsAcceptanceMode)
      if (AI_ACCEPTANCE_MODES.includes(mode as AiPanelAcceptanceMode)) setAiAcceptanceMode(mode as AiPanelAcceptanceMode)
      if (ASSISTANT_ACCEPTANCE_MODES.includes(mode as AssistantAcceptanceMode)) setAssistantAcceptanceMode(mode as AssistantAcceptanceMode)
      if (RECEIPT_ACCEPTANCE_MODES.includes(mode as ReceiptAcceptanceMode)) setReceiptAcceptanceMode(mode as ReceiptAcceptanceMode)
      if (DATA_ACCEPTANCE_MODES.includes(mode as DataToolsAcceptanceMode)) setDataAcceptanceMode(mode as DataToolsAcceptanceMode)
      if (SUBSCRIPTIONS_ACCEPTANCE_MODES.includes(mode as SubscriptionsAcceptanceMode)) setSubscriptionsAcceptanceMode(mode as SubscriptionsAcceptanceMode)
    }
    return () => { delete target.__financePlannerAcceptanceState }
  }, [])
  useEffect(() => {
    if (!window.location.search.includes('provider=google-subscriptions')) return
    const cleanUrl = new URL(window.location.href)
    for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'connected']) cleanUrl.searchParams.delete(key)
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
  }, [])
  useEffect(() => {
    if (!dialogOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [dialogOpen])

  const accountsPresentationState = useMemo(() => {
    if (accountsAcceptanceMode === 'accounts' || accountsAcceptanceMode === 'detail' || accountsAcceptanceMode === 'credit') return accountsAcceptanceState
    if (accountsAcceptanceMode === 'empty') return { ...accountsAcceptanceState, accounts: [], transactions: [] }
    return state
  }, [accountsAcceptanceMode, state])
  const planningPresentationState = useMemo(() => {
    if (planningAcceptanceMode === 'goals-empty') return { ...planningAcceptanceState, goals: [] }
    if (planningAcceptanceMode === 'recurring-empty') return { ...planningAcceptanceState, transactions: [] }
    if (planningAcceptanceMode) return planningAcceptanceState
    return state
  }, [planningAcceptanceMode, state])

  const openNewTransaction = () => {
    setEditing(null)
    setTransactionType('expense')
    setFormError('')
    setDialogOpen(true)
  }

  const openEditTransaction = (transaction: Transaction) => {
    setEditing(transaction)
    setTransactionType(transaction.type)
    setFormError('')
    setDialogOpen(true)
  }

  const saveTransaction = (formData: FormData) => {
    const input = {
      accountId: String(formData.get('accountId') ?? ''),
      description: String(formData.get('description') ?? '').trim(),
      category: String(formData.get('category') ?? '').trim(),
      amount: Number(formData.get('amount')),
      date: String(formData.get('date') ?? ''),
    }
    const validationError = validateTransactionInput(input)
    if (validationError) {
      setFormError(validationError)
      return
    }

    const transaction: Transaction = {
      id: editing?.id ?? crypto.randomUUID(),
      accountId: input.accountId,
      description: input.description,
      category: input.category,
      type: transactionType,
      amountCents: Math.round(input.amount * 100),
      date: input.date,
      recurring: formData.get('recurring') === 'on',
    }
    setState((current) => editing ? updateTransactionInState(current, transaction) : addTransactionToState(current, transaction))
    learnBehavior(transaction, transaction.category, Boolean(transaction.recurring))
    setFormError('')
    setEditing(null)
    setDialogOpen(false)
  }

  const deleteTransaction = (transactionId: string) => setState((current) => {
    const result = deleteTransactionFromState(current, transactionId)
    setDeletedTransaction(result.deleted)
    return result.state
  })

  const undoDelete = () => {
    if (!deletedTransaction) return
    setState((current) => addTransactionToState(current, deletedTransaction))
    setDeletedTransaction(null)
  }

  const applyAiSuggestion = (transactionId: string, suggestion: AiSuggestion) => {
    const source = state.transactions.find((transaction) => transaction.id === transactionId)
    if (source) learnBehavior(source, suggestion.category, suggestion.recurringProbability >= 75)
    setState((current) => ({
      ...current,
      transactions: current.transactions.map((transaction) => transaction.id === transactionId
        ? {
            ...transaction,
            description: suggestion.merchant,
            category: suggestion.category,
            recurring: suggestion.recurringProbability >= 75 || transaction.recurring,
          }
        : transaction),
    }))
  }

  const resetAll = () => {
    resetStoredState()
    setState(structuredClone(initialState))
  }

  const titles: Record<DestinationId, string> = {
    dashboard: 'Dashboard',
    transactions: 'Transactions',
    accounts: 'Accounts',
    goals: 'Goals',
    recurring: 'Recurring',
    connections: 'Connections',
    subscriptions: 'Subscriptions',
    ai: 'Finance Intelligence',
    assistant: 'Finance Assistant',
    receipt: 'Receipt Review',
    data: 'Data and Backup',
    account: 'Account',
  }

  const navigate = (destination: DestinationId) => {
    if (destination === 'transactions') setRequestedTransactionAccount(null)
    setTab(destination)
  }
  const viewAccountTransactions = (accountId: string) => { setRequestedTransactionAccount(accountId); setTab('transactions') }

  return <ApplicationShell activeDestination={tab} onNavigate={navigate} onLockVault={onLockVault}>
      {tab !== 'dashboard' && tab !== 'transactions' && tab !== 'accounts' && tab !== 'goals' && tab !== 'recurring' && <header className="topbar">
        <div>
          <p className="eyebrow">Personal finance</p>
          <h1>{titles[tab]}</h1>
        </div>
        {tab === 'ai' && <button type="button" className="primary" onClick={openNewTransaction}><Plus size={18}/> Manual entry</button>}
      </header>}

      {tab === 'dashboard' && <Dashboard state={state} userName={userName} onAddTransaction={openNewTransaction} onEditTransaction={openEditTransaction} onNavigate={navigate}/>}

      {tab === 'transactions' && <TransactionsPage
        transactions={state.transactions}
        accounts={state.accounts}
        onAdd={openNewTransaction}
        onEdit={openEditTransaction}
        onDelete={deleteTransaction}
        requestedAccountId={requestedTransactionAccount}
      />}
      {tab === 'accounts' && <AccountsPage key={accountsAcceptanceMode ?? 'live'} accounts={accountsPresentationState.accounts} transactions={accountsPresentationState.transactions} initialSelectedAccountId={accountsAcceptanceMode === 'detail' ? 'accept-checking' : accountsAcceptanceMode === 'credit' ? 'accept-card' : undefined} onOpenConnections={() => setTab('connections')} onViewTransactions={viewAccountTransactions}/>}
      {tab === 'goals' && <SavingsGoals key={planningAcceptanceMode ?? 'live'} state={planningPresentationState} onChange={setState} initialEditorOpen={planningAcceptanceMode === 'goal-editor'}/>}
      {tab === 'recurring' && <RecurringPaymentsPage transactions={planningPresentationState.transactions} onAddTransaction={openNewTransaction} onViewTransactions={() => navigate('transactions')}/>}
      {tab === 'connections' && <ConnectionsPanel key={connectionsAcceptanceMode ?? 'live'} state={state} onApply={setState} acceptanceMode={connectionsAcceptanceMode ?? undefined}/>}
      {tab === 'ai' && <AiPanel key={aiAcceptanceMode ?? 'live'} transactions={aiAcceptanceMode === 'empty' ? [] : state.transactions} onApply={applyAiSuggestion} acceptanceMode={aiAcceptanceMode ?? undefined}/>}
      {tab === 'assistant' && <FinanceAssistant key={assistantAcceptanceMode ?? 'live'} state={state} budgetAcceptanceMode={planningAcceptanceMode === 'budget-result' ? 'result' : planningAcceptanceMode === 'budget-consent' ? 'consent' : undefined} acceptanceMode={assistantAcceptanceMode ?? undefined}/>}
      {tab === 'receipt' && <ReceiptReview key={receiptAcceptanceMode ?? 'live'} acceptanceMode={receiptAcceptanceMode ?? undefined}/>}
      {tab === 'data' && <DataTools key={dataAcceptanceMode ?? 'live'} userId={userId} state={state} onRestore={setState} onReset={resetAll} acceptanceMode={dataAcceptanceMode ?? undefined}/>}
      {tab === 'account' && <AccountPage user={user} onLogout={onLogout} onNavigateToData={() => navigate('data')}/>}
      {tab === 'subscriptions' && <SubscriptionsPage key={subscriptionsAcceptanceMode ?? 'live'} state={state} onApply={setState} acceptanceMode={subscriptionsAcceptanceMode ?? undefined}/>}
    {deletedTransaction && <div className="undo-toast" role="status">
      <span>“{deletedTransaction.description}” was deleted.</span>
      <button type="button" onClick={undoDelete}><Undo2 size={16}/> Undo</button>
    </div>}

    {dialogOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setDialogOpen(false)}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-dialog-title"
        onSubmit={(event) => {
          event.preventDefault()
          saveTransaction(new FormData(event.currentTarget))
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="panel-header"><div><p className="eyebrow">{editing ? 'Update recorded activity' : 'Record activity'}</p><h2 id="transaction-dialog-title">{editing ? 'Edit transaction' : 'Add transaction'}</h2></div></div>
        <div className="segmented">
          <button type="button" aria-pressed={transactionType === 'expense'} className={transactionType === 'expense' ? 'active' : ''} onClick={() => setTransactionType('expense')}>Expense</button>
          <button type="button" aria-pressed={transactionType === 'income'} className={transactionType === 'income' ? 'active' : ''} onClick={() => setTransactionType('income')}>Income</button>
        </div>
        <label>Description<input name="description" required maxLength={160} defaultValue={editing?.description ?? ''} placeholder="For example, grocery shop"/></label>
        <label>Amount in €<input name="amount" type="number" required min="0.01" max="100000000" step="0.01" inputMode="decimal" defaultValue={editing ? editing.amountCents / 100 : undefined} placeholder="0.00"/></label>
        <label>Category<input name="category" required maxLength={80} defaultValue={editing?.category ?? ''} placeholder="For example, Groceries"/></label>
        <label>Account<select name="accountId" defaultValue={editing?.accountId ?? state.accounts[0]?.id}>{state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Date<input name="date" type="date" required defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)}/></label>
        <label className="checkbox"><input name="recurring" type="checkbox" defaultChecked={Boolean(editing?.recurring)}/> Recurring payment</label>
        {formError && <p className="status-message error-message" role="alert">{formError}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={() => setDialogOpen(false)}>Cancel</button>
          <button type="submit" className="primary">{editing ? 'Save changes' : 'Save'}</button>
        </div>
      </form>
    </div>}
  </ApplicationShell>
}

export default App
