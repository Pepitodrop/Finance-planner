import { assessBankImportQuality, suggestCategoryFromHistory, type BankImportQuality } from './bankIntelligence'
import type { Account, AppState, CreditCardDetails, Transaction } from './types'

export type ConnectorProvider = 'gocardless' | 'finapi' | 'paypal'
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type ConnectorAccountType = 'checking' | 'savings' | 'credit-card' | 'investment'

export interface ConnectorStartContext {
  institutionId?: string
  institutionName?: string
  accountType?: ConnectorAccountType
}

export interface ConnectorConnection { id: string; provider: ConnectorProvider; displayName: string; status: ConnectorStatus; lastSyncAt?: string; consentExpiresAt?: string; error?: string }
export interface ExternalAccount {
  externalId: string
  name: string
  type: Account['type']
  balanceCents: number
  currency: 'EUR'
  institutionId?: string
  creditLimitCents?: number
  availableCreditCents?: number
  statementBalanceCents?: number
  pendingAmountCents?: number
  minimumPaymentCents?: number
  statementDate?: string
  paymentDueDate?: string
}
export interface ExternalTransaction { externalId: string; externalAccountId: string; description: string; category?: string; amountCents: number; currency: 'EUR'; bookingDate: string; pending?: boolean }
export interface SyncPayload { connection: ConnectorConnection; accounts: ExternalAccount[]; transactions: ExternalTransaction[] }
export interface SyncPreview { accountsToCreate: Account[]; transactionsToImport: Transaction[]; duplicateCount: number; pendingCount: number; quality: BankImportQuality }

const REQUEST_TIMEOUT_MS = 15_000
const RETRY_DELAYS_MS = [350, 900]
const MAX_RETRY_AFTER_MS = 5_000
let activeSynchronization: Promise<SyncPayload[]> | null = null

class BankingRequestError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs: number | null = null) {
    super(message)
    this.name = 'BankingRequestError'
  }
}

function normalizeDescription(value: string): string { return value.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Unbenannte Transaktion' }
export function transactionFingerprint(transaction: Pick<Transaction, 'accountId' | 'date' | 'amountCents' | 'description'>): string { return [transaction.accountId, transaction.date, transaction.amountCents, normalizeDescription(transaction.description).toLocaleLowerCase('de-DE')].join('|') }

export function normalizeCreditCard(external: ExternalAccount): { balanceCents: number; creditCard?: CreditCardDetails } {
  if (external.type !== 'credit-card') return { balanceCents: external.balanceCents }
  const amountOwedCents = Math.abs(external.balanceCents)
  const pendingAmountCents = Math.abs(external.pendingAmountCents || 0)
  const availableCreditCents = external.availableCreditCents ?? (external.creditLimitCents !== undefined
    ? Math.max(0, external.creditLimitCents - amountOwedCents - pendingAmountCents)
    : undefined)
  return {
    balanceCents: -amountOwedCents,
    creditCard: {
      amountOwedCents,
      availableCreditCents,
      creditLimitCents: external.creditLimitCents,
      statementBalanceCents: external.statementBalanceCents === undefined ? undefined : Math.abs(external.statementBalanceCents),
      pendingAmountCents,
      minimumPaymentCents: external.minimumPaymentCents === undefined ? undefined : Math.abs(external.minimumPaymentCents),
      statementDate: external.statementDate,
      paymentDueDate: external.paymentDueDate,
    },
  }
}

export function buildSyncPreview(state: AppState, payload: SyncPayload): SyncPreview {
  const accountMap = new Map<string, string>(); const accountsToCreate: Account[] = []
  for (const external of payload.accounts) {
    const deterministicId = `connector:${payload.connection.provider}:${external.externalId}`
    const existing = state.accounts.find((account) => account.id === deterministicId)
    accountMap.set(external.externalId, deterministicId)
    if (!existing) {
      const normalized = normalizeCreditCard(external)
      accountsToCreate.push({
        id: deterministicId,
        externalId: external.externalId,
        institutionId: external.institutionId,
        name: external.name,
        type: external.type,
        balanceCents: normalized.balanceCents,
        currency: 'EUR',
        lastSyncedAt: new Date().toISOString(),
        creditCard: normalized.creditCard,
      })
    }
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

export function selectSyncPreviewAccounts(preview: SyncPreview, selectedAccountIds: Iterable<string>): SyncPreview {
  const selected = new Set(selectedAccountIds)
  const accountsToCreate = preview.accountsToCreate.filter((account) => selected.has(account.id))
  const allowed = new Set(accountsToCreate.map((account) => account.id))
  const transactionsToImport = preview.transactionsToImport.filter((transaction) => allowed.has(transaction.accountId))
  return { ...preview, accountsToCreate, transactionsToImport }
}

export function applySyncPreview(state: AppState, preview: SyncPreview): AppState { return { ...state, accounts: [...state.accounts, ...preview.accountsToCreate], transactions: [...preview.transactionsToImport, ...state.transactions] } }

function delay(milliseconds: number) { return new Promise((resolve) => window.setTimeout(resolve, milliseconds)) }
function idempotencyKey(): string { if (typeof crypto.randomUUID === 'function') return crypto.randomUUID(); const bytes = crypto.getRandomValues(new Uint8Array(16)); return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('') }
function retryAfterMilliseconds(value: string | null, now = Date.now()): number | null { if (!value) return null; const seconds = Number(value); if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS); const date = Date.parse(value); if (!Number.isFinite(date)) return null; return Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS) }

async function requestJson<T>(url: string, init: RequestInit, options: { retry?: boolean; idempotent?: boolean } = {}): Promise<T> {
  const attempts = options.retry ? RETRY_DELAYS_MS.length + 1 : 1; const key = options.idempotent ? idempotencyKey() : null; let lastError: unknown; let retryAfterMs: number | null = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const headers = new Headers(init.headers); headers.set('Accept', 'application/json'); if (key) headers.set('Idempotency-Key', key)
      const response = await fetch(url, { ...init, signal: controller.signal, credentials: 'include', headers })
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string }; requestId?: string } & T
      if (!response.ok) { const requestReference = payload.requestId || response.headers.get('X-Request-ID'); const requestSuffix = requestReference ? ` Referenz: ${requestReference}` : ''; const retryable = response.status === 429 || response.status >= 500; throw new BankingRequestError(`${payload.error?.message || `Anfrage fehlgeschlagen (${response.status}).`}${requestSuffix}`, retryable, retryAfterMilliseconds(response.headers.get('Retry-After'))) }
      return payload
    } catch (error) {
      if (error instanceof BankingRequestError) { if (!error.retryable) throw error; lastError = error; retryAfterMs = error.retryAfterMs }
      else if (error instanceof DOMException && error.name === 'AbortError') lastError = new Error('The banking backend did not respond in time.')
      else lastError = error
    } finally { window.clearTimeout(timeout) }
    if (attempt < attempts - 1) await delay(retryAfterMs ?? RETRY_DELAYS_MS[attempt])
  }
  throw lastError instanceof Error ? lastError : new Error('The banking backend is temporarily unreachable.')
}

export function connectorReturnUrl(): string { const url = new URL(window.location.href); for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'institution']) url.searchParams.delete(key); url.hash = ''; return url.toString() }
export async function startConnector(provider: ConnectorProvider, context: ConnectorStartContext = {}): Promise<void> {
  const result = await requestJson<{ redirectUrl?: string }>(`/api/connectors/${provider}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirectUri: connectorReturnUrl(), country: 'DE', institutionId: context.institutionId, institutionName: context.institutionName, accountType: context.accountType }),
  }, { idempotent: true })
  if (!result.redirectUrl || !result.redirectUrl.startsWith('https://')) throw new Error('The connector did not return a secure redirect address.')
  window.location.assign(result.redirectUrl)
}
export async function synchronizeConnections(): Promise<SyncPayload[]> { if (activeSynchronization) return activeSynchronization; const operation = (async () => { const result = await requestJson<{ connections?: SyncPayload[] }>('/api/connectors/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, { retry: true, idempotent: true }); if (!Array.isArray(result.connections)) throw new Error('The sync service returned an invalid result.'); return result.connections })(); activeSynchronization = operation; try { return await operation } finally { if (activeSynchronization === operation) activeSynchronization = null } }
export async function disconnectConnector(provider: ConnectorProvider): Promise<void> { await requestJson<{ disconnected: boolean }>(`/api/connectors/${provider}`, { method: 'DELETE' }, { idempotent: true }) }
export function consentDaysRemaining(connection: ConnectorConnection, now = Date.now()): number | null { if (!connection.consentExpiresAt) return null; const expiresAt = Date.parse(connection.consentExpiresAt); if (!Number.isFinite(expiresAt)) return null; return Math.ceil((expiresAt - now) / 86_400_000) }
