import { useState } from 'react'
import { ArrowDownRight, ArrowLeft, ArrowLeftRight, ArrowUpRight, Banknote, CreditCard, Landmark, LineChart, Plus, WalletCards } from 'lucide-react'
import { formatMoney } from '../../finance'
import { presentedTransactionType } from '../../transactionClassification'
import type { Account, AccountType, Transaction } from '../../types'
import { accountLiabilityCents, classifyDueDate, filterAccounts, summarizeAccounts, transactionsForAccount, type AccountFilter } from './accountsModel'

interface Props {
  accounts: Account[]
  transactions: Transaction[]
  onOpenConnections: () => void
  onViewTransactions: (accountId: string) => void
  referenceDate?: Date
  initialSelectedAccountId?: string
}

const FILTERS: [AccountFilter, string][] = [['all','All'],['checking','Checking'],['savings','Savings'],['cash','Cash'],['investment','Investments'],['credit-card','Credit cards']]
const LABELS: Record<AccountType,string> = { checking:'Checking', savings:'Savings', cash:'Cash', investment:'Investment', 'credit-card':'Credit card' }

function AccountIcon({ type }: { type: AccountType }) {
  const Icon = type === 'checking' ? Landmark : type === 'savings' ? WalletCards : type === 'cash' ? Banknote : type === 'investment' ? LineChart : CreditCard
  return <span className={`accounts-icon accounts-icon--${type}`} aria-hidden="true"><Icon /></span>
}

function TransactionRows({ transactions }: { transactions: Transaction[] }) {
  if (!transactions.length) return <p className="accounts-empty-copy">No transactions recorded for this account.</p>
  return <ul className="accounts-transactions" aria-label="Recent account transactions">{transactions.slice(0, 5).map((transaction) => {
    const type = presentedTransactionType(transaction)
    const Icon = type === 'income' ? ArrowUpRight : type === 'transfer' ? ArrowLeftRight : ArrowDownRight
    return <li key={transaction.id}>
      <span className={`accounts-transaction-icon accounts-transaction-icon--${type}`} aria-hidden="true"><Icon/></span>
      <span><time dateTime={transaction.date}>{new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(new Date(`${transaction.date}T12:00:00`))}</time><strong>{transaction.description}</strong><small>{type === 'transfer' ? 'Transfer' : transaction.category}</small></span>
      <b className={`accounts-money accounts-money--${type}`}><span className="sr-only">{type}: </span>{transaction.type === 'income' ? '+' : '−'}{formatMoney(transaction.amountCents)}</b>
    </li>
  })}</ul>
}

function Metadata({ account }: { account: Account }) {
  return <dl className="accounts-metadata"><div><dt>Account type</dt><dd>{LABELS[account.type]}</dd></div><div><dt>Currency</dt><dd>{account.currency}</dd></div>{account.lastSyncedAt && <div><dt>Last synced</dt><dd>{new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(account.lastSyncedAt))}</dd></div>}</dl>
}

export function AccountsPage({ accounts, transactions, onOpenConnections, onViewTransactions, referenceDate = new Date(), initialSelectedAccountId = '' }: Props) {
  const [filter, setFilter] = useState<AccountFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedAccountId || null)
  const selected = accounts.find((account) => account.id === selectedId)
  const summary = summarizeAccounts(accounts)
  const visible = filterAccounts(accounts, filter)
  const closeDetail = () => { const name = selected?.name ?? ''; setSelectedId(null); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`button[aria-label="View details for ${CSS.escape(name)}"]`)?.focus()) }
  const openDetail = (account: Account, _trigger?: HTMLButtonElement) => { setSelectedId(account.id); requestAnimationFrame(() => document.querySelector<HTMLElement>('.accounts-back')?.focus()) }

  if (selected) {
    const recent = transactionsForAccount(transactions, selected.id)
    const credit = selected.creditCard
    const owed = accountLiabilityCents(selected)
    const dueStatus = classifyDueDate(credit?.paymentDueDate, referenceDate)
    return <section className="accounts-feature accounts-detail" lang="en" data-accounts-ready="true" data-account-detail={selected.type} aria-labelledby="account-detail-title">
      <header className="accounts-detail-header"><button className="accounts-back" type="button" onClick={closeDetail}><ArrowLeft/> Back</button><div><h1 id="account-detail-title">{selected.name}</h1><p>{LABELS[selected.type]}</p></div></header>
      {selected.type === 'credit-card' ? <>
        <section className="accounts-balance accounts-balance--liability" aria-labelledby="amount-owed-title"><AccountIcon type={selected.type}/><div><h2 id="amount-owed-title">Amount owed</h2><strong>{formatMoney(owed)}</strong></div></section>
        <section className="accounts-credit-grid" aria-label="Credit details">
          {credit?.availableCreditCents !== undefined && <div><span>Available credit</span><strong>{formatMoney(credit.availableCreditCents)}</strong></div>}
          {credit?.creditLimitCents !== undefined && <div><span>Credit limit</span><strong>{formatMoney(credit.creditLimitCents)}</strong></div>}
        </section>
        {credit && <section className="accounts-panel"><h2>Payment and statement details</h2><dl className="accounts-credit-details">
          {credit.statementBalanceCents !== undefined && <div><dt>Statement balance</dt><dd>{formatMoney(credit.statementBalanceCents)}</dd></div>}
          {credit.pendingAmountCents !== undefined && <div><dt>Pending amount</dt><dd>{formatMoney(credit.pendingAmountCents)}</dd></div>}
          {credit.minimumPaymentCents !== undefined && <div><dt>Minimum payment</dt><dd>{formatMoney(credit.minimumPaymentCents)}</dd></div>}
          {credit.statementDate && <div><dt>Statement date</dt><dd>{credit.statementDate}</dd></div>}
          {credit.paymentDueDate && dueStatus !== 'invalid' && <div><dt>Payment due</dt><dd>{credit.paymentDueDate}</dd></div>}
        </dl>{credit.paymentDueDate && dueStatus !== 'invalid' && <p className={`accounts-due accounts-due--${dueStatus}`}>{dueStatus === 'overdue' ? 'Payment was due' : dueStatus === 'due-today' ? 'Payment due today' : 'Upcoming payment'}: {credit.paymentDueDate}</p>}</section>}
      </> : <><section className="accounts-balance"><AccountIcon type={selected.type}/><div><h2>Current balance</h2><strong>{formatMoney(selected.balanceCents)}</strong></div></section><Metadata account={selected}/></>}
      <section className="accounts-panel accounts-recent"><h2>Recent transactions</h2><TransactionRows transactions={recent}/></section>
      <div className="accounts-detail-actions"><button type="button" className="primary" onClick={() => onViewTransactions(selected.id)}>View all transactions</button>{selected.institutionId && <button type="button" className="secondary" onClick={onOpenConnections}>Manage connection</button>}<button type="button" className="secondary" onClick={closeDetail}>Return to accounts</button></div>
    </section>
  }

  return <section className="accounts-feature" lang="en" data-accounts-ready="true" aria-labelledby="accounts-title">
    <header className="accounts-header"><div><h1 id="accounts-title">Accounts</h1><p>See your recorded balances in one place.</p></div><button type="button" className="primary" onClick={onOpenConnections}><Plus/> Connect or add account</button></header>
    {!accounts.length ? <section className="accounts-empty" aria-labelledby="accounts-empty-title"><div className="accounts-empty-art" aria-hidden="true"><Landmark/><WalletCards/></div><h2 id="accounts-empty-title">No accounts yet</h2><p>Add an account through the existing Connections area.</p><ul><li>Connect a bank or supported provider, subject to availability.</li><li>Add a manual account.</li><li>Import a supported statement in Connections.</li></ul><button type="button" className="primary" onClick={onOpenConnections}>Connect or add account</button><p className="accounts-trust">Where applicable, Finance Planner redirects you to the provider’s official flow. Finance Planner does not ask for online-banking credentials directly.</p></section> : <>
      <section className="accounts-summary" aria-label="Account summary"><div><span>Total assets</span><strong>{formatMoney(summary.assetsCents)}</strong></div><div><span>Liabilities</span><strong className="accounts-liability">{formatMoney(summary.liabilitiesCents)}</strong></div><div><span>Net worth</span><strong>{formatMoney(summary.netWorthCents)}</strong></div><p className="sr-only">Net worth equals total assets minus liabilities.</p></section>
      <div className="accounts-filters" role="group" aria-label="Account type">{FILTERS.map(([value,label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
      {visible.some((account) => account.type !== 'credit-card') && <section className="accounts-section"><h2>Assets</h2><ul className="accounts-list">{visible.filter((account) => account.type !== 'credit-card').map((account) => <li key={account.id}><AccountIcon type={account.type}/><span><strong>{account.name}</strong><small>{LABELS[account.type]}{account.lastSyncedAt ? ' · Sync recorded' : ''}</small></span><b className="accounts-money">{formatMoney(account.balanceCents)}</b><button type="button" aria-label={`View details for ${account.name}`} onClick={(event) => openDetail(account,event.currentTarget)}>›</button></li>)}</ul></section>}
      {visible.some((account) => account.type === 'credit-card') && <section className="accounts-section accounts-section--liabilities"><h2>Liabilities</h2><ul className="accounts-list">{visible.filter((account) => account.type === 'credit-card').map((account) => <li key={account.id}><AccountIcon type={account.type}/><span><strong>{account.name}</strong><small>Credit card · Amount owed</small></span><b className="accounts-money accounts-liability">{formatMoney(accountLiabilityCents(account))}</b><button type="button" aria-label={`View details for ${account.name}`} onClick={(event) => openDetail(account,event.currentTarget)}>›</button></li>)}</ul></section>}
    </>}
  </section>
}
