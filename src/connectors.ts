import { assessBankImportQuality, suggestCategoryFromHistory, type BankImportQuality } from './bankIntelligence'
import {
  abandonConnectorPopupAttempt,
  beginConnectorPopupAttempt,
  CONNECTOR_RETURN_ATTEMPT_PARAM,
  navigateConnectorPopup,
} from './providerReturnBridge'
import type { Account, AppState, CreditCardDetails, Transaction } from './types'

export type ConnectorProvider = 'enablebanking' | 'gocardless' | 'finapi' | 'paypal'
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type ConnectorAccountType = 'checking' | 'savings' | 'credit-card' | 'investment'

export interface ConnectorStartContext {
  institutionId?: string
  institutionName?: string
  accountType?: ConnectorAccountType
}

export interface ConnectorConnection { id: string; provider: ConnectorProvider; displayName: string; status: ConnectorStatus; lastSyncAt?: string; consentExpiresAt?: string; institutionId?: string; error?: string }
// `group` is Enable Banking-specific (ASPSPGroup: cooperative banking
// networks like "Volksbanken Raiffeisenbanken" or "Sparkassen-Finanzgruppe"
// share one group.name across many concrete ASPSPs) -- sanitized the same
// way as every other field here, never more than {name, logo?}. GoCardless
// institutions never carry it. UX-only: never part of the institutionId
// contract, never used to validate a selection server-side.
export interface ProviderInstitution { id: string; name: string; bic?: string; logo?: string; country?: string; group?: { name: string; logo?: string } }
export interface ProviderDescriptor { id: ConnectorProvider; displayName: string; kind: string; available: boolean; configured: boolean; mode?: 'owner' | 'partner'; reason?: string }
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

// startConnector()'s result. When a real browser allows a popup, provider
// authorization is moved into that popup so the already-unlocked Finance
// Planner tab is never unloaded and its in-memory vault key remains intact.
// The popup return is bridged back through providerReturnBridge.ts and the
// existing callback/sync UI is remounted by ConnectionsPanel. If a popup is
// blocked, existing behavior remains the fallback: Enable Banking can use its
// embedded Auth Flow widget and other providers use the normal same-tab
// redirect. No vault password/key is persisted to achieve this.
export type ConnectorStartResult =
  | { mode: 'redirect' }
  | { mode: 'embedded-auth'; provider: 'enablebanking'; redirectUrl: string; authorizationId: string; origin: string; sandbox: boolean }

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

export function connectorReturnUrl(attemptId?: string): string {
  const url = new URL(window.location.href)
  for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'institution', CONNECTOR_RETURN_ATTEMPT_PARAM]) url.searchParams.delete(key)
  if (attemptId) url.searchParams.set(CONNECTOR_RETURN_ATTEMPT_PARAM, attemptId)
  url.hash = ''
  return url.toString()
}
// Same-origin logo proxy, never a direct link to a provider-controlled URL:
// the server re-resolves institutionId against its own live directory and
// re-validates the logo URL it finds there before ever fetching it (see
// server.js's /logo route and EnableBankingProvider.fetchInstitutionLogo()).
// The browser never learns, and never needs, the provider's real logo host.
export function providerInstitutionLogoUrl(provider: ConnectorProvider, institutionId: string): string {
  return `/api/connectors/${provider}/logo?institutionId=${encodeURIComponent(institutionId)}`
}
export async function fetchProviderStatus(): Promise<ProviderDescriptor[]> {
  const result = await requestJson<{ providers?: ProviderDescriptor[] }>('/api/connectors', { method: 'GET' }, { retry: true })
  if (!Array.isArray(result.providers)) throw new Error('The provider status response was invalid.')
  return result.providers
}
export async function fetchProviderInstitutions(provider: ConnectorProvider, country = 'DE'): Promise<ProviderInstitution[]> {
  const result = await requestJson<{ institutions?: ProviderInstitution[] }>(`/api/connectors/${provider}/institutions?country=${encodeURIComponent(country)}`, { method: 'GET' }, { retry: true })
  if (!Array.isArray(result.institutions)) throw new Error('The bank directory response was invalid.')
  return result.institutions
}
export async function startConnector(provider: ConnectorProvider, context: ConnectorStartContext = {}): Promise<ConnectorStartResult> {
  // window.open must happen synchronously inside the user's click stack;
  // opening it after the /start await would be blocked by normal popup
  // protection. Acceptance fixtures deliberately keep their deterministic
  // embedded/same-tab behavior and never create real browser windows.
  const popupAttempt = import.meta.env.VITE_ACCEPTANCE_FIXTURES === 'true' ? null : beginConnectorPopupAttempt(provider)
  try {
    const result = await requestJson<{ redirectUrl?: string; authFlow?: { provider?: string; authorizationId?: string; origin?: string; sandbox?: boolean } }>(`/api/connectors/${provider}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirectUri: connectorReturnUrl(popupAttempt?.attemptId), country: 'DE', institutionId: context.institutionId, institutionName: context.institutionName, accountType: context.accountType }),
    }, { idempotent: true })
    if (!result.redirectUrl || !result.redirectUrl.startsWith('https://')) throw new Error('The connector did not return a secure redirect address.')

    // Preferred production path: redirect only the popup. This keeps the
    // original Finance Planner document alive, so its non-extractable,
    // memory-only vault key remains unlocked. The server callback returns to
    // the popup-specific application URL, which providerReturnBridge relays
    // to the original tab without transferring any vault/provider secrets.
    if (popupAttempt) {
      navigateConnectorPopup(popupAttempt, result.redirectUrl)
      return { mode: 'redirect' }
    }

    const authFlow = result.authFlow
    // Popup blocked: preserve the existing Enable Banking widget fallback.
    // Every field is re-validated here, client-side, even though the server
    // already validated them -- this function's contract must never hand the
    // widget a value it can't itself vouch for, regardless of what the network
    // layer in between claims the response shape was.
    if (
      provider === 'enablebanking' &&
      authFlow &&
      authFlow.provider === 'enablebanking' &&
      typeof authFlow.authorizationId === 'string' && authFlow.authorizationId.length > 0 &&
      typeof authFlow.origin === 'string' && authFlow.origin.startsWith('https://')
    ) {
      return { mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: result.redirectUrl, authorizationId: authFlow.authorizationId, origin: authFlow.origin, sandbox: Boolean(authFlow.sandbox) }
    }
    window.location.assign(result.redirectUrl)
    return { mode: 'redirect' }
  } catch (error) {
    abandonConnectorPopupAttempt(popupAttempt)
    throw error
  }
}
export async function synchronizeConnections(): Promise<SyncPayload[]> { if (activeSynchronization) return activeSynchronization; const operation = (async () => { const result = await requestJson<{ connections?: SyncPayload[] }>('/api/connectors/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' } }, { retry: true, idempotent: true }); if (!Array.isArray(result.connections)) throw new Error('The sync service returned an invalid result.'); return result.connections })(); activeSynchronization = operation; try { return await operation } finally { if (activeSynchronization === operation) activeSynchronization = null } }
export type DisconnectResult = { disconnected: boolean; providerRevoked: boolean; providerRevokeReason: 'confirmed' | 'not_applicable' | 'not_supported' | 'provider_error' }
export async function disconnectConnector(provider: ConnectorProvider): Promise<DisconnectResult> { return requestJson<DisconnectResult>(`/api/connectors/${provider}`, { method: 'DELETE' }, { idempotent: true }) }
export function consentDaysRemaining(connection: ConnectorConnection, now = Date.now()): number | null { if (!connection.consentExpiresAt) return null; const expiresAt = Date.parse(connection.consentExpiresAt); if (!Number.isFinite(expiresAt)) return null; return Math.ceil((expiresAt - now) / 86_400_000) }
