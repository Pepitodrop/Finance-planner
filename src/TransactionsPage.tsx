import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, MoreHorizontal, Pencil, Search, Trash2, WalletCards } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { categoryBreakdown, formatMoney } from './finance'
import type { Account, Transaction } from './types'

interface TransactionsPageProps {
  transactions: Transaction[]
  accounts: Account[]
  onEdit: (transaction: Transaction) => void
  onDelete: (transactionId: string) => void
}

type TransactionFilter = 'all' | 'income' | 'expense'

const CATEGORY_COLORS = ['#7f42ff', '#5878ff', '#27b9ff', '#35d0cf', '#d247d7', '#ff9f43', '#54df91', '#ff6d88']
const PAGE_SIZE = 10

export function TransactionsPage({ transactions, accounts, onEdit, onDelete }: TransactionsPageProps) {
  const [typeFilter, setTypeFilter] = useState<TransactionFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [accountFilter, setAccountFilter] = useState('all')
  const [page, setPage] = useState(1)

  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const categoryOptions = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.category))].sort((a, b) => a.localeCompare(b)),
    [transactions],
  )

  const filteredTransactions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    return [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((transaction) => typeFilter === 'all' || transaction.type === typeFilter)
      .filter((transaction) => categoryFilter === 'all' || transaction.category === categoryFilter)
      .filter((transaction) => accountFilter === 'all' || transaction.accountId === accountFilter)
      .filter((transaction) => {
        if (!query) return true
        const account = accountById.get(transaction.accountId)
        return [transaction.description, transaction.category, account?.name ?? '']
          .some((value) => value.toLocaleLowerCase().includes(query))
      })
  }, [accountById, accountFilter, categoryFilter, searchQuery, transactions, typeFilter])

  useEffect(() => setPage(1), [typeFilter, searchQuery, categoryFilter, accountFilter])

  const pageCount = Math.max(1, Math.ceil(filteredTransactions.length / PAGE_SIZE))
  useEffect(() => setPage((current) => Math.min(current, pageCount)), [pageCount])
  const pageTransactions = filteredTransactions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const totals = useMemo(() => filteredTransactions.reduce(
    (result, transaction) => {
      if (transaction.type === 'income') result.incomeCents += transaction.amountCents
      else result.expenseCents += transaction.amountCents
      return result
    },
    { incomeCents: 0, expenseCents: 0 },
  ), [filteredTransactions])

  const categories = useMemo(
    () => categoryBreakdown(filteredTransactions.filter((transaction) => transaction.type === 'expense')),
    [filteredTransactions],
  )
  const totalCategoryValue = categories.reduce((sum, category) => sum + category.value, 0)
  const firstShown = filteredTransactions.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastShown = Math.min(page * PAGE_SIZE, filteredTransactions.length)

  const resetFilters = () => {
    setTypeFilter('all')
    setSearchQuery('')
    setCategoryFilter('all')
    setAccountFilter('all')
  }

  const visiblePages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => {
    const start = Math.min(Math.max(1, page - 2), Math.max(1, pageCount - 4))
    return start + index
  }).filter((value) => value <= pageCount)

  return <section className="transactions-reference-layout" aria-label="Transaktionsverwaltung">
    <article className="panel transactions-reference-main">
      <div className="transactions-toolbar">
        <div className="transaction-tabs" role="group" aria-label="Transaktionsart">
          <button type="button" className={typeFilter === 'all' ? 'active' : ''} aria-pressed={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>Alle</button>
          <button type="button" className={typeFilter === 'income' ? 'active' : ''} aria-pressed={typeFilter === 'income'} onClick={() => setTypeFilter('income')}>Einnahmen</button>
          <button type="button" className={typeFilter === 'expense' ? 'active' : ''} aria-pressed={typeFilter === 'expense'} onClick={() => setTypeFilter('expense')}>Ausgaben</button>
        </div>
        <label className="transactions-search">
          <Search size={17}/>
          <span className="sr-only">Transaktionen durchsuchen</span>
          <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Transaktionen durchsuchen …"/>
        </label>
      </div>

      <div className="transactions-table" role="table" aria-label="Transaktionen">
        <div className="transactions-table-head" role="row">
          <span role="columnheader">Datum</span>
          <span role="columnheader">Beschreibung</span>
          <span role="columnheader">Kategorie</span>
          <span role="columnheader">Konto</span>
          <span role="columnheader">Betrag</span>
          <span aria-hidden="true"/>
        </div>
        <div className="transactions-table-body">
          {pageTransactions.length > 0 ? pageTransactions.map((transaction) => {
            const account = accountById.get(transaction.accountId)
            return <div className="transactions-table-row" role="row" key={transaction.id}>
              <span className="transaction-date" role="cell">{new Date(transaction.date).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              <span className="transaction-description-cell" role="cell">
                <span className={transaction.type === 'income' ? 'transaction-merchant-icon income' : 'transaction-merchant-icon expense'}>
                  {transaction.type === 'income' ? <ArrowUpRight size={17}/> : <ArrowDownRight size={17}/>} 
                </span>
                <span><strong>{transaction.description}</strong><small>{transaction.recurring ? 'Wiederkehrende Zahlung' : 'Einmalige Buchung'}</small></span>
              </span>
              <span role="cell"><span className={`transaction-category-chip ${transaction.type}`}>{transaction.category}</span></span>
              <span className="transaction-account-cell" role="cell">
                <span className="transaction-account-icon"><WalletCards size={16}/></span>
                <span><strong>{account?.name ?? 'Unbekanntes Konto'}</strong><small>{account?.type ?? '—'}</small></span>
              </span>
              <span className={transaction.type === 'income' ? 'transaction-amount income' : 'transaction-amount expense'} role="cell">
                {transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amountCents)}
              </span>
              <span className="transaction-inline-actions" role="cell">
                <button type="button" aria-label={`${transaction.description} bearbeiten`} onClick={() => onEdit(transaction)}><Pencil size={15}/></button>
                <button type="button" aria-label={`${transaction.description} löschen`} onClick={() => onDelete(transaction.id)}><Trash2 size={15}/></button>
                <button type="button" aria-label={`Weitere Aktionen für ${transaction.description}`} onClick={() => onEdit(transaction)}><MoreHorizontal size={17}/></button>
              </span>
            </div>
          }) : <p className="transactions-empty">Keine Transaktionen entsprechen den aktuellen Filtern.</p>}
        </div>
      </div>

      <footer className="transactions-pagination">
        <span>{firstShown}–{lastShown} von {filteredTransactions.length} Transaktionen</span>
        <div className="transactions-page-buttons" aria-label="Seitennavigation">
          <button type="button" aria-label="Vorherige Seite" disabled={page === 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16}/></button>
          {visiblePages.map((pageNumber) => <button type="button" key={pageNumber} className={page === pageNumber ? 'active' : ''} aria-current={page === pageNumber ? 'page' : undefined} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
          <button type="button" aria-label="Nächste Seite" disabled={page === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}><ChevronRight size={16}/></button>
        </div>
        <span>{PAGE_SIZE} pro Seite</span>
      </footer>
    </article>

    <aside className="transactions-reference-sidebar">
      <article className="panel transactions-summary-card">
        <div className="panel-header"><h2>Zusammenfassung</h2><span className="pill">Aktuelle Auswahl</span></div>
        <dl>
          <div><dt>Einnahmen</dt><dd className="positive-text">{formatMoney(totals.incomeCents)}</dd></div>
          <div><dt>Ausgaben</dt><dd className="negative-text">-{formatMoney(totals.expenseCents)}</dd></div>
          <div className="summary-net"><dt>Netto</dt><dd>{formatMoney(totals.incomeCents - totals.expenseCents)}</dd></div>
        </dl>
      </article>

      <article className="panel transactions-category-card">
        <div className="panel-header"><h2>Ausgaben nach Kategorie</h2></div>
        <div className="transactions-category-chart">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={categories} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2}>
                {categories.map((category, index) => <Cell key={category.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}/>) }
              </Pie>
              <Tooltip formatter={(value) => formatMoney(Number(value) * 100)}/>
            </PieChart>
          </ResponsiveContainer>
          <div className="transactions-category-total"><strong>{formatMoney(totalCategoryValue * 100)}</strong><span>Gesamt</span></div>
        </div>
        <div className="transactions-category-legend">
          {categories.slice(0, 6).map((category, index) => {
            const percentage = totalCategoryValue > 0 ? Math.round((category.value / totalCategoryValue) * 100) : 0
            return <div key={category.name}><span><i style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}/>{category.name}</span><span>{percentage}%</span><strong>{formatMoney(category.value * 100)}</strong></div>
          })}
        </div>
      </article>

      <article className="panel transactions-filter-card">
        <div className="panel-header"><h2>Filter</h2><button type="button" className="panel-link" onClick={resetFilters}>Zurücksetzen</button></div>
        <label>Kategorie<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Alle Kategorien</option>{categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
        <label>Konto<select value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}><option value="all">Alle Konten</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
      </article>
    </aside>
  </section>
}
