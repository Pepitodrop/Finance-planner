import type { AppState } from './types'

/**
 * Production state is intentionally empty. A new account must never inherit
 * sample balances, transactions, recurring payments, or savings goals.
 */
export const emptyProductionState: AppState = {
  accounts: [],
  transactions: [],
  goals: [],
}

const LEGACY_DEMO_ACCOUNTS: AppState['accounts'] = [
  { id: 'account-checking', name: 'Girokonto', type: 'checking', balanceCents: 286450, currency: 'EUR' },
  { id: 'account-savings', name: 'Tagesgeld', type: 'savings', balanceCents: 420000, currency: 'EUR' },
  { id: 'account-cash', name: 'Bargeld', type: 'cash', balanceCents: 8500, currency: 'EUR' },
]

const LEGACY_DEMO_TRANSACTIONS: AppState['transactions'] = [
  { id: 't1', accountId: 'account-checking', description: 'Gehalt', category: 'Einkommen', type: 'income', amountCents: 185000, date: '2026-07-01', recurring: true },
  { id: 't2', accountId: 'account-checking', description: 'Warmmiete', category: 'Wohnen', type: 'expense', amountCents: 72000, date: '2026-07-03', recurring: true },
  { id: 't3', accountId: 'account-checking', description: 'Supermarkt', category: 'Lebensmittel', type: 'expense', amountCents: 6840, date: '2026-07-08' },
  { id: 't4', accountId: 'account-checking', description: 'Fitnessstudio', category: 'Verträge', type: 'expense', amountCents: 2990, date: '2026-07-10', recurring: true },
  { id: 't5', accountId: 'account-checking', description: 'Deutschlandticket', category: 'Mobilität', type: 'expense', amountCents: 5800, date: '2026-07-12', recurring: true },
  { id: 't6', accountId: 'account-checking', description: 'Werkstudentenjob', category: 'Einkommen', type: 'income', amountCents: 62000, date: '2026-07-15', recurring: true },
  { id: 't7', accountId: 'account-checking', description: 'Restaurant', category: 'Freizeit', type: 'expense', amountCents: 4200, date: '2026-07-18' },
]

const LEGACY_DEMO_GOALS: AppState['goals'] = [
  { id: 'g1', name: 'Notgroschen', targetCents: 600000, currentCents: 420000, targetDate: '2027-01-01' },
  { id: 'g2', name: 'Motorradführerschein A2', targetCents: 400000, currentCents: 125000, targetDate: '2027-05-01' },
]

function legacyAccountMatches(account: AppState['accounts'][number], expected: AppState['accounts'][number]): boolean {
  return account.id === expected.id
    && account.name === expected.name
    && account.type === expected.type
    && account.balanceCents === expected.balanceCents
    && account.currency === expected.currency
    && account.institutionId === expected.institutionId
    && account.externalId === expected.externalId
    && account.lastSyncedAt === expected.lastSyncedAt
    && account.creditCard === expected.creditCard
}

function legacyTransactionMatches(transaction: AppState['transactions'][number], expected: AppState['transactions'][number]): boolean {
  return transaction.id === expected.id
    && transaction.accountId === expected.accountId
    && transaction.description === expected.description
    && transaction.category === expected.category
    && transaction.type === expected.type
    && transaction.amountCents === expected.amountCents
    && transaction.date === expected.date
    && transaction.recurring === expected.recurring
}

function legacyGoalMatches(goal: AppState['goals'][number], expected: AppState['goals'][number]): boolean {
  return goal.id === expected.id
    && goal.name === expected.name
    && goal.targetCents === expected.targetCents
    && goal.currentCents === expected.currentCents
    && goal.targetDate === expected.targetDate
}

/**
 * Detect only the exact, untouched legacy starter dataset accidentally
 * persisted by older releases. Every canonical account, transaction, and goal
 * must be present with every material field unchanged, no extra records may
 * exist, and no subscription may have been added. Any user modification makes
 * the state ineligible for automatic cleanup.
 */
export function isLegacyDemoState(state: AppState): boolean {
  if (state.accounts.length !== LEGACY_DEMO_ACCOUNTS.length
    || state.transactions.length !== LEGACY_DEMO_TRANSACTIONS.length
    || state.goals.length !== LEGACY_DEMO_GOALS.length
    || (state.subscriptions?.length ?? 0) !== 0) return false

  const accountsExact = LEGACY_DEMO_ACCOUNTS.every((expected) =>
    state.accounts.some((account) => legacyAccountMatches(account, expected)),
  )
  if (!accountsExact) return false

  const transactionsExact = LEGACY_DEMO_TRANSACTIONS.every((expected) =>
    state.transactions.some((transaction) => legacyTransactionMatches(transaction, expected)),
  )
  if (!transactionsExact) return false

  return LEGACY_DEMO_GOALS.every((expected) =>
    state.goals.some((goal) => legacyGoalMatches(goal, expected)),
  )
}

export function removeLegacyDemoState(state: AppState): AppState {
  return isLegacyDemoState(state) ? structuredClone(emptyProductionState) : state
}

/**
 * Acceptance-only state used by deterministic screenshot/tests. These values
 * are never used as a production default or as a reset target.
 */
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
  goals: [
    { id:'accept-goal-emergency',name:'Emergency reserve',targetCents:600000,currentCents:420000,targetDate:'2027-01-01' },
    { id:'accept-goal-course',name:'Professional course',targetCents:400000,currentCents:125000,targetDate:'2027-05-01' },
  ],
}

export const planningAcceptanceState: AppState = {
  accounts: accountsAcceptanceState.accounts,
  transactions: [
    { id:'planning-rent',accountId:'accept-checking',description:'Home rent',category:'Housing',type:'expense',amountCents:94000,date:'2026-08-01',recurring:true },
    { id:'planning-transit',accountId:'accept-checking',description:'City mobility pass',category:'Transport',type:'expense',amountCents:4900,date:'2026-08-02',recurring:true },
    { id:'planning-fitness',accountId:'accept-card',description:'Fitness membership with access to all locations and premium classes',category:'Health',type:'expense',amountCents:2990,date:'2026-08-03',recurring:true },
    { id:'planning-cloud',accountId:'accept-card',description:'Cloud storage',category:'Services',type:'expense',amountCents:1199,date:'2026-08-04',recurring:true },
  ],
  goals: [
    { id:'planning-emergency',name:'Emergency fund',targetCents:600000,currentCents:360000,targetDate:'2026-12-15' },
    { id:'planning-course',name:'Professional course and certification with an intentionally long title',targetCents:350000,currentCents:65000,targetDate:'2027-04-30' },
    { id:'planning-home',name:'Future home deposit',targetCents:2500000,currentCents:410000,targetDate:'2029-09-30' },
  ],
}

/**
 * Kept as the application default for compatibility with existing imports.
 * It is deliberately the same empty production state.
 */
export const initialState: AppState = emptyProductionState
