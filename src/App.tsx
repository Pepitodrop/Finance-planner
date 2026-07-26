import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, BrainCircuit, CalendarClock, Landmark, PiggyBank, Plus, Repeat2, Target, WalletCards } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AiPanel } from './AiPanel'
import type { AiSuggestion } from './ai'
import { categoryBreakdown, currentMonthTotals, formatMoney, monthlyProjection, recurringPayments, totalBalance } from './finance'
import { loadState, saveState } from './storage'
import type { AppState, TransactionType } from './types'

type Tab = 'dashboard' | 'transactions' | 'goals' | 'recurring' | 'ai'

function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [tab, setTab] = useState<Tab>('dashboard')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [transactionType, setTransactionType] = useState<TransactionType>('expense')

  useEffect(() => saveState(state), [state])

  const totals = useMemo(() => currentMonthTotals(state.transactions), [state.transactions])
  const projection = useMemo(() => monthlyProjection(state), [state])
  const categories = useMemo(() => categoryBreakdown(state.transactions), [state.transactions])
  const recurring = useMemo(() => recurringPayments(state.transactions), [state.transactions])
  const net = totals.incomeCents - totals.expenseCents

  const addTransaction = (formData: FormData) => {
    const amount = Number(formData.get('amount'))
    const transaction = {
      id: crypto.randomUUID(),
      accountId: String(formData.get('accountId')),
      description: String(formData.get('description')),
      category: String(formData.get('category')),
      type: transactionType,
      amountCents: Math.round(amount * 100),
      date: String(formData.get('date')),
      recurring: formData.get('recurring') === 'on',
    }

    setState((current) => ({
      ...current,
      transactions: [transaction, ...current.transactions],
      accounts: current.accounts.map((account) =>
        account.id === transaction.accountId
          ? { ...account, balanceCents: account.balanceCents + (transaction.type === 'income' ? transaction.amountCents : -transaction.amountCents) }
          : account,
      ),
    }))
    setDialogOpen(false)
  }

  const applyAiSuggestion = (transactionId: string, suggestion: AiSuggestion) => {
    setState((current) => ({
      ...current,
      transactions: current.transactions.map((transaction) => transaction.id === transactionId ? {
        ...transaction,
        description: suggestion.merchant,
        category: suggestion.category,
        recurring: suggestion.recurringProbability >= 75 ? true : transaction.recurring,
      } : transaction),
    }))
  }

  const title = tab === 'dashboard' ? 'Finanzübersicht' : tab === 'transactions' ? 'Transaktionen' : tab === 'goals' ? 'Sparziele' : tab === 'recurring' ? 'Wiederkehrende Zahlungen' : 'KI-Finanzassistent'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Landmark size={22} /></div><div><strong>Finance Planner</strong><span>Offline-first + AI</span></div></div>
        <nav>
          <button className={tab === 'dashboard' ? 'active' : ''} onClick={() => setTab('dashboard')}><WalletCards size={19} /> Übersicht</button>
          <button className={tab === 'transactions' ? 'active' : ''} onClick={() => setTab('transactions')}><ArrowDownRight size={19} /> Transaktionen</button>
          <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}><Target size={19} /> Sparziele</button>
          <button className={tab === 'recurring' ? 'active' : ''} onClick={() => setTab('recurring')}><Repeat2 size={19} /> Verträge</button>
          <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}><BrainCircuit size={19} /> KI-Assistent</button>
        </nav>
        <div className="privacy-note"><strong>Lokal gespeichert</strong><span>Transaktionen bleiben auf deinem Gerät.</span></div>
      </aside>

      <main>
        <header className="topbar">
          <div><p className="eyebrow">Persönliche Finanzen</p><h1>{title}</h1></div>
          <button className="primary" onClick={() => setDialogOpen(true)}><Plus size={18} /> Buchung</button>
        </header>

        {tab === 'dashboard' && <>
          <section className="stats-grid">
            <article className="stat-card"><span>Gesamtvermögen</span><strong>{formatMoney(totalBalance(state))}</strong><small><ArrowUpRight size={15} /> Kontenübergreifend</small></article>
            <article className="stat-card"><span>Einnahmen im Juli</span><strong>{formatMoney(totals.incomeCents)}</strong><small><ArrowUpRight size={15} /> Wiederkehrend erkannt</small></article>
            <article className="stat-card"><span>Ausgaben im Juli</span><strong>{formatMoney(totals.expenseCents)}</strong><small className="negative"><ArrowDownRight size={15} /> Inklusive Verträge</small></article>
            <article className="stat-card highlight"><span>Monatlicher Überschuss</span><strong>{formatMoney(net)}</strong><small><PiggyBank size={15} /> Für Sparziele verfügbar</small></article>
          </section>
          <section className="dashboard-grid">
            <article className="panel projection-panel"><div className="panel-header"><div><p className="eyebrow">12 Monate</p><h2>Vermögensprognose</h2></div><span className="pill">COBOL-Kern vorbereitet</span></div><div className="chart"><ResponsiveContainer width="100%" height={290}><AreaChart data={projection}><CartesianGrid strokeDasharray="4 4" vertical={false} /><XAxis dataKey="month" /><YAxis tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} /><Tooltip formatter={(value) => formatMoney(Number(value) * 100)} /><Area type="monotone" dataKey="balance" stroke="currentColor" fill="currentColor" fillOpacity={0.15} strokeWidth={3} /></AreaChart></ResponsiveContainer></div></article>
            <article className="panel"><div className="panel-header"><div><p className="eyebrow">Ausgaben</p><h2>Kategorien</h2></div></div><div className="donut-layout"><ResponsiveContainer width="100%" height={210}><PieChart><Pie data={categories} dataKey="value" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} /><Tooltip formatter={(value) => formatMoney(Number(value) * 100)} /></PieChart></ResponsiveContainer><div className="category-list">{categories.slice(0, 5).map((category) => <div key={category.name}><span>{category.name}</span><strong>{formatMoney(category.value * 100)}</strong></div>)}</div></div></article>
          </section>
          <section className="dashboard-grid lower">
            <article className="panel"><div className="panel-header"><div><p className="eyebrow">Konten</p><h2>Deine Guthaben</h2></div></div><div className="account-list">{state.accounts.map((account) => <div className="account-row" key={account.id}><div className="account-icon"><WalletCards size={19} /></div><div><strong>{account.name}</strong><span>{account.type}</span></div><b>{formatMoney(account.balanceCents)}</b></div>)}</div></article>
            <article className="panel"><div className="panel-header"><div><p className="eyebrow">Nächste Schritte</p><h2>Sparziele</h2></div></div><div className="goal-list">{state.goals.map((goal) => { const progress = Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)); return <div className="goal-item" key={goal.id}><div><strong>{goal.name}</strong><span>{formatMoney(goal.currentCents)} von {formatMoney(goal.targetCents)}</span></div><b>{progress}%</b><div className="progress"><span style={{ width: `${progress}%` }} /></div></div> })}</div></article>
          </section>
        </>}

        {tab === 'transactions' && <section className="panel table-panel"><div className="panel-header"><div><p className="eyebrow">Verlauf</p><h2>Alle Buchungen</h2></div></div><div className="transaction-list">{[...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).map((transaction) => <div className="transaction-row" key={transaction.id}><div className={transaction.type === 'income' ? 'transaction-icon income' : 'transaction-icon expense'}>{transaction.type === 'income' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}</div><div><strong>{transaction.description}</strong><span>{transaction.category} · {new Date(transaction.date).toLocaleDateString('de-DE')}</span></div>{transaction.recurring && <span className="pill"><Repeat2 size={13} /> regelmäßig</span>}<b className={transaction.type === 'income' ? 'positive-text' : 'negative-text'}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amountCents)}</b></div>)}</div></section>}

        {tab === 'goals' && <section className="goal-card-grid">{state.goals.map((goal) => { const progress = Math.min(100, Math.round((goal.currentCents / goal.targetCents) * 100)); return <article className="panel big-goal" key={goal.id}><div className="goal-hero-icon"><Target size={24} /></div><p className="eyebrow">Ziel bis {new Date(goal.targetDate).toLocaleDateString('de-DE')}</p><h2>{goal.name}</h2><strong>{formatMoney(goal.currentCents)}</strong><span>Noch {formatMoney(goal.targetCents - goal.currentCents)} bis zum Ziel</span><div className="progress large"><span style={{ width: `${progress}%` }} /></div><b>{progress}% erreicht</b></article> })}</section>}

        {tab === 'recurring' && <section className="panel table-panel"><div className="panel-header"><div><p className="eyebrow">Automatisch erkannt</p><h2>Verträge & feste Zahlungen</h2></div><span className="pill"><CalendarClock size={14} /> {formatMoney(recurring.reduce((sum, item) => sum + item.amountCents, 0))} / Monat</span></div><div className="transaction-list">{recurring.map((transaction) => <div className="transaction-row" key={transaction.id}><div className="transaction-icon expense"><Repeat2 size={18} /></div><div><strong>{transaction.description}</strong><span>{transaction.category} · monatlich</span></div><b className="negative-text">-{formatMoney(transaction.amountCents)}</b></div>)}</div></section>}

        {tab === 'ai' && <AiPanel transactions={state.transactions} onApply={applyAiSuggestion} />}
      </main>

      {dialogOpen && <div className="modal-backdrop" onMouseDown={() => setDialogOpen(false)}><form className="modal" onSubmit={(event) => { event.preventDefault(); addTransaction(new FormData(event.currentTarget)) }} onMouseDown={(event) => event.stopPropagation()}><div className="panel-header"><div><p className="eyebrow">Neue Buchung</p><h2>Transaktion hinzufügen</h2></div></div><div className="segmented"><button type="button" className={transactionType === 'expense' ? 'active' : ''} onClick={() => setTransactionType('expense')}>Ausgabe</button><button type="button" className={transactionType === 'income' ? 'active' : ''} onClick={() => setTransactionType('income')}>Einnahme</button></div><label>Beschreibung<input name="description" required placeholder="z. B. Supermarkt" /></label><label>Betrag in €<input name="amount" type="number" required min="0.01" step="0.01" placeholder="0,00" /></label><label>Kategorie<input name="category" required placeholder="z. B. Lebensmittel" /></label><label>Konto<select name="accountId">{state.accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><label>Datum<input name="date" type="date" required defaultValue="2026-07-26" /></label><label className="checkbox"><input name="recurring" type="checkbox" /> Wiederkehrende Zahlung</label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setDialogOpen(false)}>Abbrechen</button><button type="submit" className="primary">Speichern</button></div></form></div>}
    </div>
  )
}

export default App
