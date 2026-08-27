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
  /**
   * Server-derived identity for the same real economic transaction, keyed
   * under the account's own stableId (never a session/requisition-scoped
   * account id) plus a provider's bank-assigned transaction reference.
   * Currently only populated for Enable Banking, whose entry_reference is
   * documented as immutable for accounts sharing the same identification
   * hash (see stableTransactionId()'s doc comment in
   * server/src/providers.js). GoCardless's equivalent (transactionId /
   * internalTransactionId) carries no such documented guarantee -- and has
   * a documented real-world case of changing for an existing account -- so
   * it is deliberately never populated here for GoCardless transactions.
   * Undefined when no trustworthy provider reference was available -- id
   * (this record's own local identity, provider-session-scoped like
   * Account.externalId) remains the field for ordinary same-session
   * identity/display; this field exists specifically for reconnect/history
   * reconciliation. See buildSyncPreview() in src/connectors.ts.
   */
  stableTransactionId?: string
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
