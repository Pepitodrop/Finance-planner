import type { Account, AppState, CreditCardDetails, SavingsGoal, Subscription, Transaction } from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

// Deliberately mirrors server/src/user-state-store.js's own bounds
// (MAX_EXTERNAL_ID_LENGTH / MAX_INSTITUTION_ID_LENGTH / MAX_TIMESTAMP_LENGTH)
// -- found live 2026-08-26 (PR #154, sixth Mock ASPSP pass) that this file
// validated only the always-required Account fields and was silent about
// institutionId/externalId/lastSyncedAt/creditCard, so a state this
// function accepted as a normal Account could still be predictably
// rejected by /api/finance/state the moment it actually reached the
// server's own (separately maintained, necessarily stricter) validator.
// This does not replace that server-side validator -- it exists so a
// malformed value gets caught here, close to where it was constructed,
// instead of surfacing only as an opaque cloud-sync 400 later.
const MAX_EXTERNAL_ID_LENGTH = 256
const MAX_INSTITUTION_ID_LENGTH = 256
const MAX_TIMESTAMP_LENGTH = 40
// Mirrors validateSubscription()'s per-field bounds in
// server/src/user-state-store.js -- found by adversarial review (PR #154,
// sixth Mock ASPSP pass follow-up) that isSubscription() below had no
// length bounds on id/provider/product at all, so a subscription this
// function accepted could still be predictably rejected by
// /api/finance/state, the same coherence gap this file was just fixed for.
const MAX_SUBSCRIPTION_ID_LENGTH = 128
const MAX_SUBSCRIPTION_PROVIDER_LENGTH = 80
const MAX_SUBSCRIPTION_PRODUCT_LENGTH = 160

function isBoundedString(value: unknown, maxLength: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function isOptionalBoundedString(value: unknown, maxLength: number): boolean {
  return value === undefined || isBoundedString(value, maxLength)
}

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0 && value.length <= MAX_TIMESTAMP_LENGTH && !Number.isNaN(Date.parse(value)))
}

// Uses isSafeInteger (not isFiniteInteger) to match safeInteger()'s
// Number.isSafeInteger bound in server/src/user-state-store.js -- found by
// adversarial review that isFiniteInteger alone would accept e.g. 1e20,
// which the server would reject.
function isOptionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || (isSafeInteger(value) && value >= 0)
}

const CREDIT_CARD_KEYS = new Set([
  'amountOwedCents', 'availableCreditCents', 'creditLimitCents', 'statementBalanceCents',
  'pendingAmountCents', 'minimumPaymentCents', 'statementDate', 'paymentDueDate',
])

function isCreditCardDetails(value: unknown): value is CreditCardDetails {
  if (!isRecord(value)) return false
  if (!Object.keys(value).every((key) => CREDIT_CARD_KEYS.has(key))) return false
  return isSafeInteger(value.amountOwedCents) && value.amountOwedCents >= 0
    && isOptionalNonNegativeInteger(value.availableCreditCents)
    && isOptionalNonNegativeInteger(value.creditLimitCents)
    && isOptionalNonNegativeInteger(value.statementBalanceCents)
    && isOptionalNonNegativeInteger(value.pendingAmountCents)
    && isOptionalNonNegativeInteger(value.minimumPaymentCents)
    && isOptionalTimestamp(value.statementDate)
    && isOptionalTimestamp(value.paymentDueDate)
}

// stableId is server-derived (an HMAC-SHA256 hex digest, see
// server/src/providers.js's stableAccountId()) -- bounded the same as
// externalId/institutionId rather than to the exact 64-hex-char shape, so a
// future derivation change can't make a currently-valid state fail this
// guard while still leaving the server's own stricter check as the
// authority.
const MAX_STABLE_ACCOUNT_ID_LENGTH = 256

function isAccount(value: unknown): value is Account {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && ['checking', 'savings', 'cash', 'investment', 'credit-card'].includes(String(value.type))
    && isFiniteInteger(value.balanceCents)
    && value.currency === 'EUR'
    && isOptionalBoundedString(value.institutionId, MAX_INSTITUTION_ID_LENGTH)
    && isOptionalBoundedString(value.externalId, MAX_EXTERNAL_ID_LENGTH)
    && isOptionalBoundedString(value.stableId, MAX_STABLE_ACCOUNT_ID_LENGTH)
    && isOptionalTimestamp(value.lastSyncedAt)
    && (value.creditCard === undefined || isCreditCardDetails(value.creditCard))
}

function isSubscription(value: unknown): value is Subscription {
  if (!isRecord(value)) return false
  return isBoundedString(value.id, MAX_SUBSCRIPTION_ID_LENGTH)
    && isBoundedString(value.provider, MAX_SUBSCRIPTION_PROVIDER_LENGTH)
    && isBoundedString(value.product, MAX_SUBSCRIPTION_PRODUCT_LENGTH)
    && isFiniteInteger(value.amountCents) && value.amountCents >= 0
    && value.currency === 'EUR'
    && ['weekly', 'monthly', 'quarterly', 'yearly', 'irregular'].includes(String(value.billingInterval))
    && ['active', 'paused', 'cancelled', 'expired', 'unknown'].includes(String(value.status))
    && ['google', 'bank', 'paypal', 'manual'].includes(String(value.source))
    && isOptionalTimestamp(value.nextChargeDate)
    && isOptionalBoundedString(value.externalId, MAX_EXTERNAL_ID_LENGTH)
    && isOptionalTimestamp(value.lastSyncedAt)
}

function isTransaction(value: unknown): value is Transaction {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.accountId === 'string'
    && typeof value.description === 'string'
    && typeof value.category === 'string'
    && ['income', 'expense'].includes(String(value.type))
    && isFiniteInteger(value.amountCents)
    && value.amountCents >= 0
    && typeof value.date === 'string'
    && !Number.isNaN(Date.parse(value.date))
    && (value.recurring === undefined || typeof value.recurring === 'boolean')
    && isOptionalBoundedString(value.stableTransactionId, MAX_EXTERNAL_ID_LENGTH)
}

function isSavingsGoal(value: unknown): value is SavingsGoal {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && isFiniteInteger(value.targetCents)
    && value.targetCents > 0
    && isFiniteInteger(value.currentCents)
    && value.currentCents >= 0
    && typeof value.targetDate === 'string'
    && !Number.isNaN(Date.parse(value.targetDate))
}

export function isAppState(value: unknown): value is AppState {
  if (!isRecord(value)) return false
  if (!Array.isArray(value.accounts) || !value.accounts.every(isAccount)) return false
  if (!Array.isArray(value.transactions) || !value.transactions.every(isTransaction)) return false
  if (!Array.isArray(value.goals) || !value.goals.every(isSavingsGoal)) return false
  // subscriptions is optional on AppState -- absent entirely is valid (most
  // states have none), but if present it must actually be well-formed.
  // Previously unchecked here at all, which is exactly the same class of
  // silent-drift gap the server-side validator had (see
  // server/src/user-state-store.js's validateSubscription()).
  if (value.subscriptions !== undefined && (!Array.isArray(value.subscriptions) || !value.subscriptions.every(isSubscription))) return false

  const accountIds = new Set(value.accounts.map((account) => account.id))
  return value.transactions.every((transaction) => accountIds.has(transaction.accountId))
}

export function validateTransactionInput(input: {
  accountId: string
  description: string
  category: string
  amount: number
  date: string
}): string | null {
  if (!input.accountId) return 'Select an account.'
  if (input.description.trim().length < 2) return 'Enter a description of at least two characters.'
  if (input.description.length > 160) return 'Description must not exceed 160 characters.'
  if (input.category.trim().length < 2) return 'Enter a valid category.'
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 100_000_000) return 'Enter a valid positive amount.'
  if (!input.date || Number.isNaN(Date.parse(input.date))) return 'Enter a valid date.'
  return null
}
