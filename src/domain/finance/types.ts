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
  /**
   * Deterministic, provider-agnostic identity for the same real-world
   * account across separate provider sessions/consents (e.g. a reconnect) --
   * distinct from externalId, which is session/consent-scoped and expected
   * to change on reauthorization. Server-derived only (see
   * server/src/providers.js's stableAccountId()); never a raw IBAN/account
   * number, and undefined when the provider offered no trustworthy stable
   * identifier for this account. Used to reconcile reconnected accounts
   * (see buildSyncPreview() in src/connectors.ts) and to key a user's
   * per-account sync-exclusion decision so a removed account isn't silently
   * re-imported.
   */
  stableId?: string
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
