import { assessBankImportQuality, suggestCategoryFromHistory, type BankImportQuality } from './bankIntelligence'
import type { Account, AppState, Transaction } from './types'

export type ConnectorProvider = 'gocardless' | 'finapi' | 'paypal'
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ConnectorConnection { id: string; provider: ConnectorProvider; displayName: string; status: ConnectorStatus; lastSyncAt?: string; consentExpiresAt?: string; error?: string }
export interface ExternalAccount { externalId: string; name: string; type: Account['type']; balanceCents: number; currency: 'EUR' }
export interface ExternalTransaction { externalId: string; externalAccountId: string; description: string; category?: string; amountCents: number; currency: 'EUR'; bookingDate: string; pending?: boolean }
export interface SyncPayload { connection: ConnectorConnection; accounts: ExternalAccount[]; transactions: ExternalTransaction[] }
export interface SyncPreview { accountsToCreate: Account[]; transactionsToImport: Transaction[]; duplicateCount: number; pendingCount: number; quality: BankImportQuality }

const REQUEST_TIMEOUT_MS = 15_000
const RETRY_DELAYS_MS = [350, 900]

class BankingRequestError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'BankingRequestError'
  }
}

function normalizeDescription(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unbenannte Transaktion' }
export function transactionFingerprint(transaction: Pick<Transaction, 'accountId' | 'date' | 'amountCents' | 'description'>): string { return [transaction.accountId, transaction.date, transaction.amountCents, normalizeDescription(transaction.description).toLocaleLowerCase('de-DE')].join('|') }

export function buildSyncPreview(state: AppState, payload: SyncPayload): SyncPreview {
  const accountMap = new Map<string, string>(); const accountsToCreate: Account[] = []
  for (const external of payload.accounts) {
    const deterministicId = `connector:${payload.connection.provider}:${external.externalId}`
    const existing = state.accounts.find((account) => account.id === deterministicId)
    accountMap.set(external.externalId, deterministicId)
    if (!existing) accountsToCreate.push({ id: deterministicId, name: external.name, type: external.type, balanceCents: external.balanceCents, currency: 'EUR' })
  }
  const known = new Set(state.transactions.map(transactionFingerprint)); const transactionsToImport: Transaction[] = []; let duplicateCount = 0; let pendingCount = 0; let smartCategorized = 0
  for (const external of payload.transactions) {
    if (external.currency !== 'EUR') continue
    if (external.pending) { pendingCount += 1; continue }
    const accountId = accountMap.get(external.externalAccountId); if (!accountId) continue
    const description = normalizeDescription(external.description)
    const learned = external.category?.trim() ? null : suggestCategoryFromHistory(description, state.transactions)
    const category = external.category?.trim() || learned?.category || 'Unkategorisiert'
    const transaction: Transaction = { id: `connector:${payload.connection.provider}:${external.externalId}`, accountId, description, category, type: external.amountCents >= 0 ? 'income' : 'expense', amountCents: Math.abs(external.amountCents), date: external.bookingDate, recurring: false }
    const fingerprint = transactionFingerprint(transaction)
    if (known.has(fingerprint) || state.transactions.some((item) => item.id === transaction.id)) { duplicateCount += 1; continue }
    known.add(fingerprint)
    transactionsToImport.push(transaction)
    if (learned) smartCategorized += 1
  }
  return { accountsToCreate, transactionsToImport, duplicateCount, pendingCount, quality: assessBankImportQuality(transactionsToImport, smartCategorized) }
}

export function applySyncPreview(state: AppState, preview: SyncPreview): AppState { return { ...state, accounts: [...state.accounts, ...preview.accountsToCreate], transactions: [...preview.transactionsToImport, ...state.transactions] } }

async function initializeDevelopmentSession(baseUrl: string): Promise<void> {
  if (!/^http:\/\/localhost(?::\d+)?$/.test(baseUrl)) return
  const response = await fetch(`${baseUrl}/api/session/local`, { method: 'POST', credentials: 'include' })
  if (!response.ok) throw new Error(`Lokale Backend-Sitzung konnte nicht gestartet werden (${response.status}).`)
}

function delay(milliseconds: number) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)) }

async function requestJson<T>(url: string, init: RequestInit, options: { retry?: boolean } = {}): Promise<T> {
  const attempts = options.retry ? RETRY_DELAYS_MS.length + 1 : 1
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'include', headers: { Accept: 'application/json', ...init.headers } })
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; requestId?: string } & T
      if (!response.ok) {
        const requestSuffix = payload.requestId ? ` Referenz: ${payload.requestId}` : ''
        const retryable = response.status === 429 || response.status >= 500
        throw new BankingRequestError(`${payload.error?.message || `Anfrage fehlgeschlagen (${response.status}).`}${requestSuffix}`, retryable)
      }
      return payload
    } catch (error) {
      if (error instanceof BankingRequestError) {
        if (!error.retryable) throw error
        lastError = error
      } else if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new Error('Das Banking-Backend hat nicht rechtzeitig geantwortet.')
      } else {
        lastError = error
      }
    } finally {
      window.clearTimeout(timeout)
    }
    if (attempt < attempts - 1) await delay(RETRY_DELAYS_MS[attempt])
  }
  throw lastError instanceof Error ? lastError : new Error('Das Banking-Backend ist vorübergehend nicht erreichbar.')
}

export function connectorReturnUrl(): string {
  const url = new URL(window.location.href)
  for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider']) url.searchParams.delete(key)
  url.hash = ''
  return url.toString()
}

export async function startConnector(provider: ConnectorProvider, backendBaseUrl: string): Promise<void> {
  const baseUrl = backendBaseUrl.replace(/\/$/, '')
  await initializeDevelopmentSession(baseUrl)
  const result = await requestJson<{ redirectUrl?: string }>(`${baseUrl}/api/connectors/${provider}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirectUri: connectorReturnUrl(), country: 'DE' }),
  })
  if (!result.redirectUrl || !result.redirectUrl.startsWith('https://')) throw new Error('Der Connector lieferte keine sichere Weiterleitungsadresse.')
  window.location.assign(result.redirectUrl)
}

export async function synchronizeConnections(backendBaseUrl: string): Promise<SyncPayload[]> {
  const baseUrl = backendBaseUrl.replace(/\/$/, '')
  await initializeDevelopmentSession(baseUrl)
  const result = await requestJson<{ connections?: SyncPayload[] }>(`${baseUrl}/api/connectors/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  }, { retry: true })
  if (!Array.isArray(result.connections)) throw new Error('Der Sync-Dienst lieferte ein ungültiges Ergebnis.')
  return result.connections
}

export async function disconnectConnector(provider: ConnectorProvider, backendBaseUrl: string): Promise<void> {
  const baseUrl = backendBaseUrl.replace(/\/$/, '')
  await initializeDevelopmentSession(baseUrl)
  await requestJson<{ disconnected: boolean }>(`${baseUrl}/api/connectors/${provider}`, { method: 'DELETE' })
}

export function consentDaysRemaining(connection: ConnectorConnection, now = Date.now()): number | null {
  if (!connection.consentExpiresAt) return null
  const expiresAt = Date.parse(connection.consentExpiresAt)
  if (!Number.isFinite(expiresAt)) return null
  return Math.ceil((expiresAt - now) / 86_400_000)
}
