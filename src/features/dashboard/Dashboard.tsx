import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Landmark,
  MoreHorizontal,
  PiggyBank,
  Plus,
  Target,
  Trash2,
  WalletCards,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ConfirmationDialog } from '../../app/ConfirmationDialog'
import { connectorProviderFromAccountId } from '../../connectors'
import { formatMoney } from '../../finance'
import { MerchantLogo } from '../../MerchantLogo'
import type { Account, AppState, Transaction } from '../../types'
import type { DestinationId } from '../../app/navigation'
import { buildDashboardViewModel, isDetectedTransfer } from './dashboardModel'

const CATEGORY_COLORS = ['#8b6aee', '#557de8', '#36a9c8', '#42aaa0', '#c166bb', '#d9964f', '#7b86a9', '#b47cdb']

interface DashboardProps {
  state: AppState
  userName?: string
  onAddTransaction: () => void
  onEditTransaction: (transaction: Transaction) => void
  onNavigate: (destination: DestinationId) => void
  onRemoveAccount: (accountId: string) => void
  referenceDate?: Date
}

// Mirrors TransactionsPage.tsx's TransactionActions -- same "⋯" trigger +
// dismiss-on-outside-click/Escape menu pattern, reused here instead of a
// second bespoke implementation. Only one action exists today (Remove
// account), kept as a menu rather than a bare icon button so a future
// second per-account action has an obvious place to go, and so the
// destructive action is never a single unconfirmed click -- this only
// *opens* the confirmation dialog, it never removes anything itself.
function DashboardAccountActions({ account, onRequestRemove }: { account: Account; onRequestRemove: (account: Account) => void }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key === 'Escape') {
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      } else if (event instanceof MouseEvent && !containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [open])

  return <div className="dashboard-account-actions" ref={containerRef}>
    <button ref={triggerRef} type="button" className="dashboard-account-actions-trigger" aria-label={`Actions for ${account.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((current) => !current)}><MoreHorizontal size={16}/></button>
    {open && <div className="dashboard-account-actions-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setOpen(false); onRequestRemove(account) }}><Trash2 size={15}/> Remove account</button>
    </div>}
  </div>
}

const ACCOUNT_TYPE_LABELS = {
  checking: 'Checking',
  savings: 'Savings',
  cash: 'Cash',
  investment: 'Investment',
  'credit-card': 'Credit card',
} as const

function signedMoney(transaction: Transaction): string {
  if (isDetectedTransfer(transaction)) return formatMoney(transaction.amountCents)
  return `${transaction.type === 'income' ? '+' : '−'}${formatMoney(transaction.amountCents)}`
}

export function Dashboard({ state, userName, onAddTransaction, onEditTransaction, onNavigate, onRemoveAccount, referenceDate = new Date() }: DashboardProps) {
  const model = useMemo(() => buildDashboardViewModel(state, referenceDate), [referenceDate, state])
  const firstName = userName?.trim().split(/\s+/)[0] || 'there'
  const categoryTotalCents = model.categories.reduce((sum, category) => sum + category.amountCents, 0)
  const projectedEndCents = Math.round((model.projection.at(-1)?.balance ?? model.totalBalanceCents / 100) * 100)
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null)
  const removeTargetTransactionCount = removeTarget ? state.transactions.filter((transaction) => transaction.accountId === removeTarget.id).length : 0
  const removeTargetProvider = removeTarget ? connectorProviderFromAccountId(removeTarget.id) : undefined

  return <div className="dashboard-page" data-dashboard-ready="true" lang="en">
    <header className="dashboard-toolbar">
      <div>
        <h1>Dashboard</h1>
        <p>Welcome back, {firstName}. Here is your financial overview.</p>
      </div>
      <button type="button" className="primary dashboard-add-action" onClick={onAddTransaction}>
        <Plus size={18}/> Add transaction
      </button>
    </header>

    <section className="dashboard-summary" aria-labelledby="dashboard-summary-title">
      <h2 id="dashboard-summary-title" className="fp-visually-hidden">Current financial summary</h2>
      <article className="dashboard-balance-card">
        <div><span>Net worth</span><strong>{formatMoney(model.totalBalanceCents)}</strong><small>Across {state.accounts.length} {state.accounts.length === 1 ? 'account' : 'accounts'}</small></div>
        <span className="dashboard-summary-icon" aria-hidden="true"><WalletCards size={25}/></span>
      </article>
      <div className="dashboard-period-summary">
        <p>This month · {model.periodLabel}</p>
        <div className="dashboard-period-metrics">
          <article className="dashboard-metric income">
            <span className="dashboard-summary-icon" aria-hidden="true"><ArrowUpRight size={20}/></span>
            <div><span>Income</span><strong>+{formatMoney(model.incomeCents)}</strong><small>Money in</small></div>
          </article>
          <article className="dashboard-metric expense">
            <span className="dashboard-summary-icon" aria-hidden="true"><ArrowDownRight size={20}/></span>
            <div><span>Expenses</span><strong>−{formatMoney(model.expenseCents)}</strong><small>Money out</small></div>
          </article>
          <article className={`dashboard-metric ${model.surplusCents >= 0 ? 'income' : 'expense'}`}>
            <span className="dashboard-summary-icon" aria-hidden="true"><PiggyBank size={20}/></span>
            <div><span>Surplus</span><strong>{model.surplusCents >= 0 ? '+' : '−'}{formatMoney(Math.abs(model.surplusCents))}</strong><small>{model.surplusCents >= 0 ? 'Money remaining' : 'Monthly shortfall'}</small></div>
          </article>
        </div>
      </div>
    </section>

    <section className="dashboard-analysis-grid" aria-label="Dashboard analysis">
      <article className="dashboard-panel dashboard-projection" aria-labelledby="projection-title">
        <div className="dashboard-panel-header">
          <div><h2 id="projection-title">Balance projection</h2><p>Next 12 months</p></div>
          <span>Projection</span>
        </div>
        <div className="dashboard-chart" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={model.projection} margin={{ top: 12, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid stroke="var(--fp-color-chart-grid)" strokeDasharray="4 6" vertical={false}/>
              <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={22}/>
              <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={(value) => `€${Math.round(Number(value) / 1000)}K`}/>
              <Tooltip formatter={(value) => formatMoney(Number(value) * 100)} labelFormatter={(label) => label === 'Today' ? 'Current balance' : `${label} projection`}/>
              <ReferenceLine x="Today" stroke="var(--fp-color-chart-label)" strokeDasharray="2 4" label={{ value: 'Today', position: 'top', fill: 'var(--fp-color-text-secondary)' }}/>
              <Line type="linear" dataKey="currentBalance" stroke="var(--fp-color-chart-current)" strokeWidth={3} dot={{ r: 5, fill: 'var(--fp-color-chart-current)' }} activeDot={{ r: 6 }} connectNulls={false}/>
              <Area type="monotone" dataKey="projectedBalance" stroke="var(--fp-color-chart-projection)" strokeDasharray="6 6" fill="var(--fp-color-accent-muted)" fillOpacity={0.7} strokeWidth={3} connectNulls/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="dashboard-chart-legend"><span><i/>Current balance starts at Today</span><span><i/>Dotted line: projected balance</span></div>
        <p className="dashboard-chart-caption">This deterministic projection starts with your current account balance and applies the average monthly cash flow found in your recorded transactions. It is not historical or investment performance.</p>
        <p className="fp-visually-hidden">Current balance is {formatMoney(model.totalBalanceCents)}. The projected balance after 12 months is {formatMoney(projectedEndCents)}.</p>
      </article>

      <article className="dashboard-panel dashboard-categories" aria-labelledby="categories-title">
        <div className="dashboard-panel-header"><div><h2 id="categories-title">Expenses by category</h2><p>{model.periodLabel}</p></div></div>
        {model.categories.length > 0 ? <>
          <div className="dashboard-category-layout">
            <div className="dashboard-category-chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={model.categories} dataKey="amountCents" nameKey="name" innerRadius="57%" outerRadius="83%" paddingAngle={2}>{model.categories.map((category, index) => <Cell key={category.name} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]}/>)}</Pie><Tooltip formatter={(value) => formatMoney(Number(value))}/></PieChart>
              </ResponsiveContainer>
              <div><strong>{formatMoney(categoryTotalCents)}</strong><span>Total</span></div>
            </div>
            <dl className="dashboard-category-list">
              {model.categories.slice(0, 6).map((category, index) => <div key={category.name}>
                <dt><i style={{ backgroundColor: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}/><span>{category.name}</span></dt>
                <dd><span>{category.percentage}%</span><strong>{formatMoney(category.amountCents)}</strong></dd>
              </div>)}
            </dl>
          </div>
          <p className="dashboard-category-total">Current-month category total <strong>{formatMoney(categoryTotalCents)}</strong></p>
        </> : <div className="dashboard-empty"><strong>No expenses this month</strong><span>Expense categories will appear after you record an outgoing transaction.</span></div>}
      </article>
    </section>

    <section className="dashboard-preview-grid" aria-label="Financial previews">
      <article className="dashboard-panel dashboard-preview dashboard-accounts" aria-labelledby="accounts-preview-title">
        <div className="dashboard-panel-header"><div><h2 id="accounts-preview-title">Accounts</h2><p>Recorded balances</p></div></div>
        {model.accounts.length > 0 ? <div className="dashboard-preview-list">
          {model.accounts.map((account) => <div className="dashboard-account-row" key={account.id}>
            <span className="dashboard-row-icon" aria-hidden="true"><Landmark size={18}/></span>
            <span><strong>{account.name}</strong><small>{ACCOUNT_TYPE_LABELS[account.type]}</small></span>
            <b>{formatMoney(account.balanceCents)}</b>
            <DashboardAccountActions account={account} onRequestRemove={setRemoveTarget}/>
          </div>)}
        </div> : <div className="dashboard-empty"><strong>No accounts recorded</strong><span>Connect or add an account to include it in your balance.</span><button type="button" onClick={() => onNavigate('connections')}>Open Connections</button></div>}
      </article>

      <article className="dashboard-panel dashboard-preview dashboard-goals" aria-labelledby="goals-preview-title">
        <div className="dashboard-panel-header"><div><h2 id="goals-preview-title">Goals</h2><p>Saved against targets</p></div><button type="button" onClick={() => onNavigate('goals')}>Manage goals</button></div>
        {model.goals.length > 0 ? <div className="dashboard-goal-list">
          {model.goals.map((goal) => <div className="dashboard-goal-row" key={goal.id}>
            <span className="dashboard-row-icon" aria-hidden="true"><Target size={18}/></span>
            <div><span><strong>{goal.name}</strong><b>{goal.progress}%</b></span><div className="dashboard-progress" role="progressbar" aria-label={`${goal.name}: ${goal.progress}% saved`} aria-valuenow={goal.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${goal.progress}%` }}/></div><small>{formatMoney(goal.currentCents)} of {formatMoney(goal.targetCents)}</small></div>
          </div>)}
        </div> : <div className="dashboard-empty"><strong>No savings goals yet</strong><span>Create a goal to track deterministic progress toward a target.</span><button type="button" onClick={() => onNavigate('goals')}>Open Goals</button></div>}
      </article>

      <article className="dashboard-panel dashboard-preview dashboard-recent" aria-labelledby="recent-title">
        <div className="dashboard-panel-header"><div><h2 id="recent-title">Recent transactions</h2><p>Latest recorded activity</p></div><button type="button" onClick={() => onNavigate('transactions')}>View all</button></div>
        {model.recentTransactions.length > 0 ? <div className="dashboard-recent-list">
          {model.recentTransactions.map((transaction) => {
            const transfer = isDetectedTransfer(transaction)
            const account = state.accounts.find((item) => item.id === transaction.accountId)
            const Icon = transfer ? ArrowLeftRight : transaction.type === 'income' ? ArrowUpRight : ArrowDownRight
            const semantic = transfer ? 'transfer' : transaction.type
            return <button type="button" className="dashboard-transaction-row" key={transaction.id} onClick={() => onEditTransaction(transaction)} aria-label={`Edit ${transaction.description}`}>
              {transfer
                ? <span className={`dashboard-row-icon ${semantic}`} aria-hidden="true"><Icon size={18}/></span>
                : <MerchantLogo description={transaction.description} type={transaction.type}/>}
              <span><strong>{transaction.description}</strong><small>{new Date(`${transaction.date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {transfer ? 'Transfer' : transaction.category}{account ? ` · ${account.name}` : ''}</small></span>
              <b className={semantic}>{signedMoney(transaction)}</b>
            </button>
          })}
        </div> : <div className="dashboard-empty"><strong>No transactions yet</strong><span>Use the Add transaction button above to record your first transaction.</span></div>}
      </article>
    </section>

    <ConfirmationDialog
      open={removeTarget !== null}
      severity="danger"
      heading={`Remove "${removeTarget?.name ?? ''}"?`}
      headingId="dashboard-remove-account-title"
      confirmLabel="Remove account"
      onConfirm={() => { if (removeTarget) onRemoveAccount(removeTarget.id); setRemoveTarget(null) }}
      onClose={() => setRemoveTarget(null)}
    >
      <p>This removes the account and its imported/recorded transactions from Finance Planner.</p>
      <p>{removeTargetTransactionCount === 0
        ? 'This account has no recorded transactions.'
        : `This account has ${removeTargetTransactionCount} transaction${removeTargetTransactionCount === 1 ? '' : 's'}. Removing the account will also remove ${removeTargetTransactionCount === 1 ? 'that transaction' : `those ${removeTargetTransactionCount} transactions`}.`}</p>
      {removeTargetProvider && <p>If this account belongs to a connected bank, the bank connection itself will remain active unless you choose to disconnect it separately. This account will not be automatically re-imported on future syncs of that connection.</p>}
    </ConfirmationDialog>
  </div>
}
