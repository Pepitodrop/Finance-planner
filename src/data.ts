import type { AppState } from './types'

const normalInitialState: AppState = {
  accounts: [
    { id: 'account-checking', name: 'Girokonto', type: 'checking', balanceCents: 286450, currency: 'EUR' },
    { id: 'account-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 420000, currency: 'EUR' },
    { id: 'account-cash', name: 'Bargeld', type: 'cash', balanceCents: 8500, currency: 'EUR' },
  ],
  transactions: [
    { id: 't1', accountId: 'account-checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 185000, date: '2026-07-01', recurring: true },
    { id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
    { id: 't3', accountId: 'account-checking', description: 'Supermarkt', category: 'Lebensmittel', type: 'expense', amountCents: 6840, date: '2026-07-08' },
    { id: 't4', accountId: 'account-checking', description: 'Fitnessstudio', category: 'Verträge', type: 'expense', amountCents: 2990, date: '2026-07-10', recurring: true },
    { id: 't5', accountId: 'account-checking', description: 'Deutschlandticket', category: 'Mobilität', type: 'expense', amountCents: 5800, date: '2026-07-12', recurring: true },
    { id: 't6', accountId: 'account-checking', description: 'Werkstudentenjob', category: 'Einkommen', type: 'income', amountCents: 62000, date: '2026-07-15', recurring: true },
    { id: 't7', accountId: 'account-checking', description: 'Restaurant', category: 'Freizeit', type: 'expense', amountCents: 4200, date: '2026-07-18' },
  ],
  goals: [
    { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
    { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
  ],
}

export const accountsAcceptanceState: AppState = {
  accounts: [
    { id:'accept-checking',name:'Everyday checking account',type:'checking',balanceCents:842050,currency:'EUR' },
    { id:'accept-savings',name:'Family emergency savings and future plans',type:'savings',balanceCents:2540000,currency:'EUR' },
    { id:'accept-cash',name:'Cash wallet',type:'cash',balanceCents:125000,currency:'EUR' },
    { id:'accept-investment',name:'Long-term investment account',type:'investment',balanceCents:10875000,currency:'EUR' },
    { id:'accept-card',name:'Household credit card',type:'credit-card',balanceCents:-248000,currency:'EUR',institutionId:'acceptance-institution',creditCard:{amountOwedCents:248000,availableCreditCents:502000,creditLimitCents:750000,statementBalanceCents:220000,pendingAmountCents:28000,minimumPaymentCents:7500,statementDate:'2026-07-25',paymentDueDate:'2026-08-18'} },
    { id:'accept-empty-transactions',name:'Reserve account without activity',type:'savings',balanceCents:0,currency:'EUR' },
  ],
  transactions: [
    {id:'accept-salary',accountId:'accept-checking',description:'Salary',category:'Income',type:'income',amountCents:285000,date:'2026-08-01'},
    {id:'accept-rent',accountId:'accept-checking',description:'Rent payment',category:'Housing',type:'expense',amountCents:94000,date:'2026-08-01'},
    {id:'accept-transfer',accountId:'accept-checking',description:'Transfer to emergency savings',category:'Transfer',type:'expense',amountCents:50000,date:'2026-07-31'},
    {id:'accept-supplies',accountId:'accept-card',description:'Household supplies',category:'Shopping',type:'expense',amountCents:8420,date:'2026-08-02'},
  ],
  goals: normalInitialState.goals,
}

export const initialState: AppState = normalInitialState
