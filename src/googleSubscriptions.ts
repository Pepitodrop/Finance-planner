import type { AppState, BillingInterval, Subscription, SubscriptionStatus, Transaction } from './types'

export interface GoogleSubscriptionRecord {
  externalId: string
  provider: string
  product: string
  amountCents: number
  currency: 'EUR'
  billingInterval: BillingInterval
  nextChargeDate?: string
  status: SubscriptionStatus
}

export interface GoogleSubscriptionCapability {
  enabled: boolean
  source: 'gmail' | 'custom' | 'invalid'
  configured: boolean
  ready: boolean
  connected?: boolean
  reason?: string
  requiredScopes?: string[]
  limitations: string[]
  lastSyncAt?: string
}

export interface GoogleSubscriptionConnection {
  connected: boolean
  source?: 'gmail' | 'custom'
  lastSyncAt?: string
  subscriptions: GoogleSubscriptionRecord[]
  limitations?: string[]
  capability?: GoogleSubscriptionCapability
  unavailableReason?: string
}

export interface GoogleSubscriptionDisconnectResult {
  disconnected: boolean
  revoked: boolean
  deletedImportedData: boolean
  deletedSubscriptionCount: number
  cloudStateUpdated: boolean
}

function normalizeText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase()
}

function comparableMonthlyAmount(subscription: Pick<Subscription, 'amountCents' | 'billingInterval'>): number {
  if (subscription.billingInterval === 'weekly') return Math.round(subscription.amountCents * 52 / 12)
  if (subscription.billingInterval === 'quarterly') return Math.round(subscription.amountCents / 3)
  if (subscription.billingInterval === 'yearly') return Math.round(subscription.amountCents / 12)
  return subscription.amountCents
}

export function subscriptionMatchesTransaction(subscription: Subscription, transaction: Transaction): boolean {
  if (!transaction.recurring || transaction.type !== 'expense') return false
  const description = normalizeText(transaction.description)
  const provider = normalizeText(subscription.provider)
  const product = normalizeText(subscription.product)
  const textMatch = Boolean(provider && description.includes(provider)) || Boolean(product && description.includes(product))
  if (!textMatch) return false
  const monthly = comparableMonthlyAmount(subscription)
  const tolerance = Math.max(50, Math.round(monthly * 0.03))
  return Math.abs(transaction.amountCents - monthly) <= tolerance || Math.abs(transaction.amountCents - subscription.amountCents) <= tolerance
}

export function normalizeGoogleSubscriptions(records: GoogleSubscriptionRecord[], now = new Date().toISOString()): Subscription[] {
  const unique = new Map<string, Subscription>()
  for (const record of records) {
    if (!record.externalId || !Number.isSafeInteger(record.amountCents) || record.amountCents < 0 || record.currency !== 'EUR') continue
    if (!['weekly', 'monthly', 'quarterly', 'yearly'].includes(record.billingInterval)) continue
    if (!['active', 'paused', 'cancelled', 'expired'].includes(record.status)) continue
    unique.set(record.externalId, {
      id: `google:${record.externalId}`,
      externalId: record.externalId,
      provider: record.provider.trim() || 'Google',
      product: record.product.trim() || 'Unknown Google subscription',
      amountCents: record.amountCents,
      currency: 'EUR',
      billingInterval: record.billingInterval,
      nextChargeDate: record.nextChargeDate,
      status: record.status,
      source: 'google',
      lastSyncedAt: now,
    })
  }
  return [...unique.values()]
}

export function reconcileGoogleSubscriptions(state: AppState, imported: Subscription[]): AppState {
  const existing = state.subscriptions || []
  const nonGoogle = existing.filter((subscription) => subscription.source !== 'google')
  const reconciled = imported.filter((subscription) => !state.transactions.some((transaction) => subscriptionMatchesTransaction(subscription, transaction)))
  return { ...state, subscriptions: [...nonGoogle, ...reconciled] }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  })
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message || `Google subscriptions request failed (${response.status}).`)
  return payload
}

export function getGoogleSubscriptionCapability(): Promise<GoogleSubscriptionCapability> {
  return request('/api/subscriptions/google/capability')
}

// Strips OAuth-specific query params (and any hash) from a candidate return
// URL before it's sent as redirectUri -- prevents a stale code/state/error
// from a previous attempt leaking into a fresh connection request if the
// user retries from the same page without a full navigation in between.
function cleanReturnUrl(returnUrl: string): string {
  const url = new URL(returnUrl)
  url.hash = ''
  for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'connected']) url.searchParams.delete(key)
  return url.toString()
}

export async function startGoogleSubscriptionConnection(returnUrl = window.location.href): Promise<void> {
  const result = await request<{ redirectUrl?: string }>('/api/subscriptions/google/start', { method: 'POST', body: JSON.stringify({ redirectUri: cleanReturnUrl(returnUrl) }) })
  if (!result.redirectUrl) throw new Error('Google did not return an authorization address.')
  // Origin check (not just startsWith) so a redirect URL like
  // https://accounts.google.com.evil.example/... can never pass -- it would
  // satisfy a naive prefix check but isn't the real Google origin.
  const authorization = new URL(result.redirectUrl)
  if (authorization.protocol !== 'https:' || authorization.origin !== 'https://accounts.google.com') {
    throw new Error('Google did not return a valid authorization address.')
  }
  window.location.assign(authorization.toString())
}

export async function syncGoogleSubscriptions(): Promise<GoogleSubscriptionConnection> {
  return request('/api/subscriptions/google/sync', { method: 'POST', body: '{}' })
}

export function disconnectGoogleSubscriptions(deleteImportedData = false): Promise<GoogleSubscriptionDisconnectResult> {
  return request('/api/subscriptions/google', { method: 'DELETE', body: JSON.stringify({ deleteImportedData }) })
}
