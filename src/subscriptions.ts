import type { AppState, Subscription, Transaction } from './types'

export interface GoogleSubscriptionConnection {
  connected: boolean
  email?: string
  lastSyncAt?: string
  limitations?: string[]
}

export interface GoogleSubscriptionSync {
  connection: GoogleSubscriptionConnection
  subscriptions: Subscription[]
}

function fingerprint(subscription: Pick<Subscription, 'provider' | 'product' | 'amountCents' | 'billingInterval'>): string {
  return [subscription.provider, subscription.product, subscription.amountCents, subscription.billingInterval]
    .map((value) => String(value).trim().toLocaleLowerCase('de-DE'))
    .join('|')
}

function recurringFingerprint(transaction: Transaction): string {
  return [transaction.description, transaction.amountCents]
    .map((value) => String(value).trim().toLocaleLowerCase('de-DE'))
    .join('|')
}

export function reconcileSubscriptions(state: AppState, incoming: Subscription[]): AppState {
  const current = state.subscriptions || []
  const known = new Map(current.map((item) => [item.externalId ? `${item.source}:${item.externalId}` : fingerprint(item), item]))
  const recurring = new Set(state.transactions.filter((item) => item.recurring).map(recurringFingerprint))

  for (const item of incoming) {
    if (!Number.isSafeInteger(item.amountCents) || item.amountCents < 0 || item.currency !== 'EUR') continue
    const key = item.externalId ? `${item.source}:${item.externalId}` : fingerprint(item)
    const bankDuplicate = recurring.has([item.product, item.amountCents].map((value) => String(value).trim().toLocaleLowerCase('de-DE')).join('|'))
    known.set(key, { ...known.get(key), ...item, id: known.get(key)?.id || item.id, source: bankDuplicate ? 'bank' : item.source })
  }
  return { ...state, subscriptions: [...known.values()] }
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message || `Anfrage fehlgeschlagen (${response.status}).`)
  return payload
}

export async function startGoogleSubscriptionConnection(returnUrl = window.location.href): Promise<void> {
  const callback = new URL(returnUrl)
  callback.hash = ''
  for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider']) callback.searchParams.delete(key)
  const result = await json<{ redirectUrl: string }>('/api/subscriptions/google/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirectUri: callback.toString() }),
  })
  if (!result.redirectUrl?.startsWith('https://accounts.google.com/')) throw new Error('Google lieferte keine gültige Autorisierungsadresse.')
  window.location.assign(result.redirectUrl)
}

export function synchronizeGoogleSubscriptions(): Promise<GoogleSubscriptionSync> {
  return json('/api/subscriptions/google/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
}

export async function disconnectGoogleSubscriptions(deleteImportedData = false): Promise<void> {
  await json(`/api/subscriptions/google?deleteImportedData=${deleteImportedData ? 'true' : 'false'}`, { method: 'DELETE' })
}
