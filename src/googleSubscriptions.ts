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

export interface GoogleSubscriptionConnection {
  connected: boolean
  lastSyncAt?: string
  subscriptions: GoogleSubscriptionRecord[]
  unavailableReason?: string
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
    unique.set(record.externalId, {
      id: `google:${record.externalId}`,
      externalId: record.externalId,
      provider: record.provider.trim() || 'Google',
      product: record.product.trim() || 'Unbekanntes Google-Abonnement',
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
  const response = await fetch(url, { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message || `Google-Abonnement-Anfrage fehlgeschlagen (${response.status}).`)
  return payload
}

export async function startGoogleSubscriptionConnection(returnUrl = window.location.href): Promise<void> {
  const result = await request<{ redirectUrl?: string }>('/api/subscriptions/google/start', { method: 'POST', body: JSON.stringify({ redirectUri: returnUrl }) })
  if (!result.redirectUrl?.startsWith('https://')) throw new Error('Google lieferte keine sichere Weiterleitungsadresse.')
  window.location.assign(result.redirectUrl)
}

export async function syncGoogleSubscriptions(): Promise<GoogleSubscriptionConnection> {
  return request<GoogleSubscriptionConnection>('/api/subscriptions/google/sync', { method: 'POST' })
}

export async function disconnectGoogleSubscriptions(deleteImportedData = false): Promise<void> {
  await request<{ disconnected: boolean }>('/api/subscriptions/google', { method: 'DELETE', body: JSON.stringify({ deleteImportedData }) })
}
