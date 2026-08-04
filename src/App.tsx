import { useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  Plus,
  Repeat2,
  Undo2,
} from 'lucide-react'
import { AiPanel } from './AiPanel'
import type { AiSuggestion } from './ai'
import { learnBehavior } from './behavior'
import { ConnectionsPanel } from './ConnectionsPanel'
import { DataTools } from './DataTools'
import { initialState } from './data'
import { FinanceAssistant } from './FinanceAssistant'
import { ReceiptReview } from './ReceiptReview'
import { SavingsGoals } from './SavingsGoals'
import { TransactionsPage } from './TransactionsPage'
import { formatMoney, recurringPayments } from './finance'
import { Dashboard } from './features/dashboard/Dashboard'
import { loadState, resetStoredState, saveState } from './storage'
import { addTransactionToState, deleteTransactionFromState, updateTransactionInState } from './transactionState'
import type { AppState, Transaction, TransactionType } from './types'
import { validateTransactionInput } from './validation'
import { ApplicationShell } from './app/ApplicationShell'
import type { DestinationId } from './app/navigation'

interface AppProps { userId: string; userName?: string; onLockVault?: () => void }

function App({ userId, userName, onLockVault }: AppProps) {
  const [state, setState] = useState<AppState>(() => loadState())
  const [tab, setTab] = useState<DestinationId>('dashboard')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [transactionType, setTransactionType] = useState<TransactionType>('expense')
  const [formError, setFormError] = useState('')
  const [deletedTransaction, setDeletedTransaction] = useState<Transaction | null>(null)

  useEffect(() => saveState(state), [state])
  useEffect(() => {
    if (!dialogOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [dialogOpen])

  const recurring = useMemo(() => recurringPayments(state.transactions), [state.transactions])

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
    transactions: 'Transaktionen',
    goals: 'Sparziele',
    recurring: 'Wiederkehrende Zahlungen',
    connections: 'Banken & PayPal',
    ai: 'KI-Kategorisierung',
    assistant: 'Finanzanalyse & Planung',
    receipt: 'Nachhaltiger Beleg-Check',
    data: 'Daten & Backup',
  }

  return <ApplicationShell activeDestination={tab} onNavigate={setTab} onLockVault={onLockVault}>
      {tab !== 'dashboard' && <header className={`topbar ${tab === 'transactions' ? 'transactions-topbar' : ''}`}>
        <div>
          {tab === 'transactions' ? <>
            <h1>Transactions</h1>
            <p className="dashboard-subtitle">Track, manage and review all your transactions.</p>
          </> : <>
            <p className="eyebrow">Persönliche Finanzen</p>
            <h1>{titles[tab]}</h1>
          </>}
        </div>
        <button type="button" className="primary" onClick={openNewTransaction}><Plus size={18}/> Manuelle Buchung</button>
      </header>}

      {tab === 'dashboard' && <Dashboard state={state} userName={userName} onAddTransaction={openNewTransaction} onEditTransaction={openEditTransaction} onNavigate={setTab}/>}

      {tab === 'transactions' && <TransactionsPage
        transactions={state.transactions}
        accounts={state.accounts}
        onEdit={openEditTransaction}
        onDelete={deleteTransaction}
      />}
      {tab === 'goals' && <SavingsGoals state={state} onChange={setState}/>} 
      {tab === 'recurring' && <section className="panel table-panel">
        <div className="panel-header">
          <div><p className="eyebrow">Automatisch erkannt</p><h2>Verträge & feste Zahlungen</h2></div>
          <span className="pill"><CalendarClock size={14}/> {formatMoney(recurring.reduce((sum, item) => sum + item.amountCents, 0))} / Monat</span>
        </div>
        <div className="transaction-list">
          {recurring.map((transaction) => <div className="transaction-row" key={transaction.id}>
            <div className="transaction-icon expense"><Repeat2 size={18}/></div>
            <div><strong>{transaction.description}</strong><span>{transaction.category} · regelmäßig</span></div>
            <b className="negative-text">-{formatMoney(transaction.amountCents)}</b>
          </div>)}
        </div>
      </section>}
      {tab === 'connections' && <ConnectionsPanel state={state} onApply={setState}/>} 
      {tab === 'ai' && <AiPanel transactions={state.transactions} onApply={applyAiSuggestion}/>} 
      {tab === 'assistant' && <FinanceAssistant state={state}/>} 
      {tab === 'receipt' && <ReceiptReview/>}
      {tab === 'data' && <DataTools userId={userId} state={state} onRestore={setState} onReset={resetAll}/>} 
    {deletedTransaction && <div className="undo-toast" role="status">
      <span>„{deletedTransaction.description}“ wurde gelöscht.</span>
      <button type="button" onClick={undoDelete}><Undo2 size={16}/> Rückgängig</button>
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
        <div className="panel-header"><div><p className="eyebrow">{editing ? 'Buchung ändern' : 'Neue Buchung'}</p><h2 id="transaction-dialog-title">{editing ? 'Transaktion bearbeiten' : 'Transaktion hinzufügen'}</h2></div></div>
        <div className="segmented">
          <button type="button" aria-pressed={transactionType === 'expense'} className={transactionType === 'expense' ? 'active' : ''} onClick={() => setTransactionType('expense')}>Ausgabe</button>
          <button type="button" aria-pressed={transactionType === 'income'} className={transactionType === 'income' ? 'active' : ''} onClick={() => setTransactionType('income')}>Einnahme</button>
        </div>
        <label>Beschreibung<input name="description" required maxLength={160} defaultValue={editing?.description ?? ''} placeholder="z. B. Supermarkt"/></label>
        <label>Betrag in €<input name="amount" type="number" required min="0.01" max="100000000" step="0.01" inputMode="decimal" defaultValue={editing ? editing.amountCents / 100 : undefined} placeholder="0,00"/></label>
        <label>Kategorie<input name="category" required maxLength={80} defaultValue={editing?.category ?? ''} placeholder="z. B. Lebensmittel"/></label>
        <label>Konto<select name="accountId" defaultValue={editing?.accountId ?? state.accounts[0]?.id}>{state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
        <label>Datum<input name="date" type="date" required defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)}/></label>
        <label className="checkbox"><input name="recurring" type="checkbox" defaultChecked={Boolean(editing?.recurring)}/> Wiederkehrende Zahlung</label>
        {formError && <p className="status-message error-message" role="alert">{formError}</p>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={() => setDialogOpen(false)}>Abbrechen</button>
          <button type="submit" className="primary">{editing ? 'Änderungen speichern' : 'Speichern'}</button>
        </div>
      </form>
    </div>}
  </ApplicationShell>
}

export default App
