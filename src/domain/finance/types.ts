export type AccountType = 'checking' | 'savings' | 'cash' | 'investment' | 'credit-card'
export type TransactionType = 'income' | 'expense'

export interface CreditCardDetails {
  /** Positive integer amount currently owed by the card holder. */
  amountOwedCents: number
  availableCreditCents?: number
  creditLimitCents?: number
  statementBalanceCents?: number
  pendingAmountCents?: number
  minimumPaymentCents?: number
  statementDate?: string
  paymentDueDate?: string
}

export interface Account {
  id: string
  name: string
  type: AccountType
  /** Asset accounts are positive. Credit-card accounts store the ledger balance as a negative liability. */
  balanceCents: number
  currency: 'EUR'
  institutionId?: string
  externalId?: string
  lastSyncedAt?: string
  creditCard?: CreditCardDetails
}

export interface Transaction {
  id: string
  accountId: string
  description: string
  category: string
  type: TransactionType
  amountCents: number
  date: string
  recurring?: boolean
}

export type SubscriptionSource = 'google' | 'bank' | 'paypal' | 'manual'
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'expired' | 'unknown'
export type BillingInterval = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'irregular'

export interface Subscription {
  id: string
  provider: string
  product: string
  amountCents: number
  currency: 'EUR'
  billingInterval: BillingInterval
  nextChargeDate?: string
  status: SubscriptionStatus
  source: SubscriptionSource
  externalId?: string
  lastSyncedAt?: string
}

export interface SavingsGoal {
  id: string
  name: string
  targetCents: number
  currentCents: number
  targetDate: string
}

export interface AppState {
  accounts: Account[]
  transactions: Transaction[]
  goals: SavingsGoal[]
  subscriptions?: Subscription[]
}
