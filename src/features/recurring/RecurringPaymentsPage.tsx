import { Plus, Repeat2, Search } from 'lucide-react'
import { formatMoney } from '../../finance'
import { MerchantLogo } from '../../MerchantLogo'
import type { Transaction } from '../../types'
import { recurringMeaning, recurringPresentation } from './recurringModel'

interface Props { transactions: Transaction[]; onAddTransaction: () => void; onViewTransactions: () => void }

export function RecurringPaymentsPage({ transactions, onAddTransaction, onViewTransactions }: Props) {
  const { items, monthlyTotalCents } = recurringPresentation(transactions)
  return <main className="recurring-page" lang="en" data-feature="recurring">
    <header className="planning-toolbar"><div><h1>Recurring payments</h1><p>Recurring activity identified from your recorded transactions.</p></div></header>
    {items.length === 0 ? <section className="planning-empty" aria-labelledby="recurring-empty-title"><span className="planning-empty-icon"><Repeat2/></span><h2 id="recurring-empty-title">No recurring activity identified</h2><p>Finance Planner has not identified repeating activity in your recorded transactions.</p><small>Detection is based on recorded patterns and may not represent a confirmed contract.</small><div className="planning-empty-actions"><button className="primary" onClick={onAddTransaction}><Plus/> Add a transaction</button><button className="secondary" onClick={onViewTransactions}><Search/> View transactions</button></div></section> : <>
      <section className="recurring-total" aria-label="Recurring payment summary"><span>Estimated monthly total</span><strong>{formatMoney(monthlyTotalCents)}</strong><small>Based on the detected records shown.</small></section>
      <section aria-labelledby="recurring-list-title"><h2 id="recurring-list-title" className="visually-hidden">Detected recurring activity</h2><ul className="recurring-list">{items.map((item) => <li key={item.transaction.id}><MerchantLogo description={item.transaction.description} type={item.transaction.type}/><div><h3>{item.transaction.description}</h3><p>{item.transaction.category}</p><small>{recurringMeaning(item)}</small></div><strong className="negative-text"><span className="visually-hidden">Expense </span>−{formatMoney(item.transaction.amountCents)}</strong></li>)}</ul></section>
    </>}
  </main>
}
