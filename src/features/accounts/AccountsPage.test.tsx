import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Account, Transaction } from '../../types'
import { AccountsPage } from './AccountsPage'

const accounts: Account[]=[
  {id:'checking',name:'Everyday checking account with a deliberately long name',type:'checking',balanceCents:842_050,currency:'EUR'},
  {id:'investment',name:'Long-term investment account',type:'investment',balanceCents:10_875_000,currency:'EUR'},
  {id:'card',name:'Household credit card',type:'credit-card',balanceCents:-248_000,currency:'EUR',institutionId:'institution',creditCard:{amountOwedCents:248_000,availableCreditCents:502_000,creditLimitCents:750_000,statementBalanceCents:220_000,pendingAmountCents:28_000,minimumPaymentCents:7_500,statementDate:'2026-07-25',paymentDueDate:'2026-08-18'}},
]
const transactions: Transaction[]=[{id:'salary',accountId:'checking',description:'Salary',category:'Income',type:'income',amountCents:285_000,date:'2026-08-01'}]
const setup=(override:Partial<Parameters<typeof AccountsPage>[0]>={})=>{const callbacks={onOpenConnections:vi.fn(),onViewTransactions:vi.fn()};return {...render(<AccountsPage accounts={accounts} transactions={transactions} referenceDate={new Date(2026,7,4)} {...callbacks} {...override}/>),...callbacks}}
afterEach(cleanup)

describe('AccountsPage',()=>{
  it('renders an English reconciled overview and accessible filters',()=>{const {container}=setup();expect(container.querySelector('[data-accounts-ready=true]')).toHaveAttribute('lang','en');expect(screen.getByRole('heading',{level:1,name:'Accounts'})).toBeInTheDocument();expect(screen.getByLabelText('Account summary')).toHaveTextContent('117.170,50');fireEvent.click(screen.getByRole('button',{name:'Credit cards'}));expect(screen.queryByText(/Everyday checking/)).not.toBeInTheDocument();expect(screen.getByText('Household credit card')).toBeInTheDocument()})
  it('opens standard detail, filters transactions and returns with focus',async()=>{const user=userEvent.setup();setup();await user.click(screen.getByRole('button',{name:/View details for Everyday/}));expect(screen.getByRole('heading',{level:1,name:/Everyday checking/})).toBeInTheDocument();expect(screen.getByText('Salary')).toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Back'}));await vi.waitFor(()=>expect(screen.getByRole('button',{name:/View details for Everyday/})).toHaveFocus())})
  it('renders genuine credit-card fields and future status',async()=>{const user=userEvent.setup();setup();await user.click(screen.getByRole('button',{name:'View details for Household credit card'}));expect(screen.getByText('Amount owed')).toBeInTheDocument();expect(screen.getByText('Available credit')).toBeInTheDocument();expect(screen.getByText(/Upcoming payment/)).toBeInTheDocument()})
  it('uses real connection and transaction callbacks',async()=>{const user=userEvent.setup();const view=setup();await user.click(screen.getByRole('button',{name:/View details for Everyday/}));await user.click(screen.getByRole('button',{name:'View all transactions'}));expect(view.onViewTransactions).toHaveBeenCalledWith('checking');await user.click(screen.getByRole('button',{name:'Return to accounts'}));await user.click(screen.getByRole('button',{name:'Connect or add account'}));expect(view.onOpenConnections).toHaveBeenCalled()})
  it('renders an honest empty state without account rows',()=>{const view=setup({accounts:[],transactions:[]});expect(screen.getByRole('heading',{name:'No accounts yet'})).toBeInTheDocument();expect(screen.queryByRole('button',{name:/View details/})).not.toBeInTheDocument();fireEvent.click(within(screen.getByLabelText('Accounts').closest('section') ?? document.body).getAllByRole('button',{name:'Connect or add account'})[0]);expect(view.onOpenConnections).toHaveBeenCalled()})
})
