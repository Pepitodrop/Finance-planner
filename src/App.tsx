import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BrainCircuit, CalendarClock, DatabaseBackup, Landmark, Link2, MessageCircleQuestion, Pencil, PiggyBank, Plus, Repeat2, Target, Trash2, Undo2, WalletCards } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AiPanel } from './AiPanel'
import type { AiSuggestion } from './ai'
import { learnBehavior } from './behavior'
import { ConnectionsPanel } from './ConnectionsPanel'
import { DataTools } from './DataTools'
import { initialState } from './data'
import { FinanceAssistant } from './FinanceAssistant'
import { SavingsGoals } from './SavingsGoals'
import { categoryBreakdown, currentMonthTotals, formatMoney, monthlyProjection, recurringPayments, totalBalance } from './finance'
import { loadState, resetStoredState, saveState } from './storage'
import { addTransactionToState, deleteTransactionFromState, updateTransactionInState } from './transactionState'
import type { AppState, Transaction, TransactionType } from './types'
import { validateTransactionInput } from './validation'

type Tab = 'dashboard' | 'transactions' | 'goals' | 'recurring' | 'connections' | 'ai' | 'assistant' | 'data'

const CATEGORY_COLORS = ['#5878ff', '#5fe0a0', '#ff9f5b', '#ff8b96', '#7dd3fc', '#c084fc', '#f4d35e', '#4dd0c4']

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [tab, setTab] = useState<Tab>('dashboard')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [transactionType, setTransactionType] = useState<TransactionType>('expense')
  const [formError, setFormError] = useState('')
  const [deletedTransaction, setDeletedTransaction] = useState<Transaction | null>(null)

  useEffect(() => saveState(state), [state])

  const totals = useMemo(() => currentMonthTotals(state.transactions), [state.transactions])
  const projection = useMemo(() => monthlyProjection(state), [state])
  const categories = useMemo(() => categoryBreakdown(state.transactions), [state.transactions])
  const recurring = useMemo(() => recurringPayments(state.transactions), [state.transactions])
  const net = totals.incomeCents - totals.expenseCents
  const monthLabel = new Intl.DateTimeFormat('de-DE', { month: 'long' }).format(new Date())

  const openNewTransaction = () => { setEditing(null); setTransactionType('expense'); setFormError(''); setDialogOpen(true) }
  const openEditTransaction = (transaction: Transaction) => { setEditing(transaction); setTransactionType(transaction.type); setFormError(''); setDialogOpen(true) }

  const saveTransaction = (formData: FormData) => {
    const input = {
      accountId: String(formData.get('accountId') ?? ''),
      description: String(formData.get('description') ?? '').trim(),
      category: String(formData.get('category') ?? '').trim(),
      amount: Number(formData.get('amount')),
      date: String(formData.get('date') ?? ''),
    }
    const validationError = validateTransactionInput(input)
    if (validationError) { setFormError(validationError); return }

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
    setFormError(''); setEditing(null); setDialogOpen(false)
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
        ? { ...transaction, description: suggestion.merchant, category: suggestion.category, recurring: suggestion.recurringProbability >= 75 || transaction.recurring }
        : transaction),
    }))
  }

  const resetAll = () => { resetStoredState(); setState(structuredClone(initialState)) }
  const titles: Record<Tab, string> = {
    dashboard: 'Finanzübersicht', transactions: 'Transaktionen', goals: 'Sparziele', recurring: 'Wiederkehrende Zahlungen',
    connections: 'Banken & PayPal', ai: 'KI-Kategorisierung', assistant: 'Finanzanalyse & Planung', data: 'Daten & Backup',
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Landmark size={22}/></div><div><strong>Finance Planner</strong><span>Offline-first + AI</span></div></div>
      <nav>
        <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><WalletCards size={19}/> Übersicht</button>
        <button className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}><ArrowDownRight size={19}/> Transaktionen</button>
        <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}><Target size={19}/> Sparziele</button>
        <button className={tab === 'recurring' ? 'active' : ''} onClick={() => setTab('recurring')}><Repeat2 size={19}/> Verträge</button>
        <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}><Link2 size={19}/> Verbindungen</button>
        <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}><BrainCircuit size={19}/> KI-Lernen</button>
        <button className={tab === 'assistant' ? 'active' : ''} onClick={() => setTab('assistant')}><MessageCircleQuestion size={19}/> Assistent</button>
        <button className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}><DatabaseBackup size={19}/> Daten</button>
      </nav>
      <div className="privacy-note"><strong>Verschlüsselt gespeichert</strong><span>Bank-Secrets bleiben ausschließlich im Backend.</span></div>
    </aside>

    <main>
      <header className="topbar"><div><p className="eyebrow">Persönliche Finanzen</p><h1>{titles[tab]}</h1></div><button className="primary" onClick={openNewTransaction}><Plus size={18}/> Manuelle Buchung</button></header>

      {tab === 'dashboard' && <>
        <section className="stats-grid">
          <article className="stat-card"><span>Gesamtvermögen</span><strong>{formatMoney(totalBalance(state))}</strong><small><ArrowUpRight size={15}/> Kontenübergreifend</small></article>
          <article className="stat-card"><span>Einnahmen im {monthLabel}</span><strong>{formatMoney(totals.incomeCents)}</strong><small><ArrowUpRight size={15}/> Erfasst</small></article>
          <article className="stat-card"><span>Ausgaben im {monthLabel}</span><strong>{formatMoney(totals.expenseCents)}</strong><small className="negative"><ArrowDownRight size={15}/> Inklusive Verträge</small></article>
          <article className="stat-card highlight"><span>Monatlicher Überschuss</span><strong>{formatMoney(net)}</strong><small><PiggyBank size={15}/> Für Sparziele verfügbar</small></article>
        </section>
        <section className="dashboard-grid">
          <article className="panel projection-panel"><div className="panel-header"><div><p className="eyebrow">12 Monate</p><h2>Vermögensprognose</h2></div><span className="pill">Deterministisch</span></div><div className="chart"><ResponsiveContainer width="100%" height={290}><AreaChart data={projection}><CartesianGrid strokeDasharray="4 4" vertical={false}/><XAxis dataKey="month"/><YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}/><Tooltip formatter={(value) => formatMoney(Number(value) * 100)}/><Area type="monotone" dataKey="balance" stroke="currentColor" fill="currentColor" fillOpacity={0.15} strokeWidth={3}/></AreaChart></ResponsiveContainer></div></article>
          <article className="panel"><div className="panel-header"><div><p className="eyebrow">Ausgaben</p><h2>Kategorien</h2></div></div><div className="donut-layout"><ResponsiveContainer width="100%" height={210}><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3}>{categories.map((category, index) => <Cell key={category.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}/>)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value) * 100)}/></PieChart></ResponsiveContainer><div className="category-list">{categories.slice(0, 5).map((category, index) => <div key={category.name}><span><i className="category-dot" style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}/>{category.name}</span><strong>{formatMoney(category.value * 100)}</strong></div>)}</div></div></article>
        </section>
        <section className="dashboard-grid lower">
          <article className="panel"><div className="panel-header"><div><p className="eyebrow">Konten</p><h2>Deine Guthaben</h2></div></div><div className="account-list">{state.accounts.map((account) => <div className="account-row" key={account.id}><div className="account-icon"><WalletCards size={19}/></div><div><strong>{account.name}</strong><span>{account.type}</span></div><b>{formatMoney(account.balanceCents)}</b></div>)}</div></article>
          <article className="panel"><div className="panel-header"><div><p className="eyebrow">Nächste Schritte</p><h2>Sparziele</h2></div></div><div className="goal-list">{state.goals.map((goal) => { const progress = Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)); return <div className="goal-item" key={goal.id}><div><strong>{goal.name}</strong><span>{formatMoney(goal.currentCents)} von {formatMoney(goal.targetCents)}</span></div><b>{progress}%</b><div className="progress"><span style={{ width: `${progress}%` }}/></div></div> })}</div></article>
        </section>
      </>}

      {tab === 'transactions' && <section className="panel table-panel"><div className="panel-header"><div><p className="eyebrow">Verlauf</p><h2>Alle Buchungen</h2></div></div><div className="transaction-list">{[...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).map((transaction) => <div className="transaction-row" key={transaction.id}><div className={transaction.type === 'income' ? 'transaction-icon income' : 'transaction-icon expense'}>{transaction.type === 'income' ? <ArrowUpRight size={18}/> : <ArrowDownRight size={18}/>}</div><div><strong>{transaction.description}</strong><span>{transaction.category} · {new Date(transaction.date).toLocaleDateString('de-DE')}</span></div>{transaction.recurring && <span className="pill"><Repeat2 size={13}/> regelmäßig</span>}<b className={transaction.type === 'income' ? 'positive-text' : 'negative-text'}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amountCents)}</b><div className="row-actions"><button aria-label="Transaktion bearbeiten" onClick={() => openEditTransaction(transaction)}><Pencil size={16}/></button><button aria-label="Transaktion löschen" onClick={() => deleteTransaction(transaction.id)}><Trash2 size={16}/></button></div></div>)}</div></section>}
      {tab === 'goals' && <SavingsGoals state={state} onChange={setState}/>} 
      {tab === 'recurring' && <section className="panel table-panel"><div className="panel-header"><div><p className="eyebrow">Automatisch erkannt</p><h2>Verträge & feste Zahlungen</h2></div><span className="pill"><CalendarClock size={14}/> {formatMoney(recurring.reduce((sum, item) => sum + item.amountCents, 0))} / Monat</span></div><div className="transaction-list">{recurring.map((transaction) => <div className="transaction-row" key={transaction.id}><div className="transaction-icon expense"><Repeat2 size={18}/></div><div><strong>{transaction.description}</strong><span>{transaction.category} · regelmäßig</span></div><b className="negative-text">-{formatMoney(transaction.amountCents)}</b></div>)}</div></section>}
      {tab === 'connections' && <ConnectionsPanel state={state} onApply={setState}/>} 
      {tab === 'ai' && <AiPanel transactions={state.transactions} onApply={applyAiSuggestion}/>} 
      {tab === 'assistant' && <FinanceAssistant state={state}/>} 
      {tab === 'data' && <DataTools state={state} onRestore={setState} onReset={resetAll}/>} 
    </main>

    {deletedTransaction && <div className="undo-toast" role="status"><span>„{deletedTransaction.description}“ wurde gelöscht.</span><button onClick={undoDelete}><Undo2 size={16}/> Rückgängig</button></div>}
    {dialogOpen && <div className="modal-backdrop" onMouseDown={() => setDialogOpen(false)}><form className="modal" onSubmit={(event) => { event.preventDefault(); saveTransaction(new FormData(event.currentTarget)) }} onMouseDown={(event) => event.stopPropagation()}><div className="panel-header"><div><p className="eyebrow">{editing ? 'Buchung ändern' : 'Neue Buchung'}</p><h2>{editing ? 'Transaktion bearbeiten' : 'Transaktion hinzufügen'}</h2></div></div><div className="segmented"><button type="button" className={transactionType === 'expense' ? 'active' : ''} onClick={() => setTransactionType('expense')}>Ausgabe</button><button type="button" className={transactionType === 'income' ? 'active' : ''} onClick={() => setTransactionType('income')}>Einnahme</button></div><label>Beschreibung<input name="description" required maxLength={160} defaultValue={editing?.description ?? ''} placeholder="z. B. Supermarkt"/></label><label>Betrag in €<input name="amount" type="number" required min="0.01" max="100000000" step="0.01" inputMode="decimal" defaultValue={editing ? editing.amountCents / 100 : undefined} placeholder="0,00"/></label><label>Kategorie<input name="category" required maxLength={80} defaultValue={editing?.category ?? ''} placeholder="z. B. Lebensmittel"/></label><label>Konto<select name="accountId" defaultValue={editing?.accountId ?? state.accounts[0]?.id}>{state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Datum<input name="date" type="date" required defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)}/></label><label className="checkbox"><input name="recurring" type="checkbox" defaultChecked={Boolean(editing?.recurring)}/> Wiederkehrende Zahlung</label>{formError && <p className="status-message error-message" role="alert">{formError}</p>}<div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialogOpen(false)}>Abbrechen</button><button type="submit" className="primary">{editing ? 'Änderungen speichern' : 'Speichern'}</button></div></form></div>}
  </div>
}

export default App
