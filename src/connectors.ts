import { assessBankImportQuality, suggestCategoryFromHistory, type BankImportQuality } from './bankIntelligence'
import {
  abandonConnectorPopupAttempt,
  beginConnectorPopupAttempt,
  CONNECTOR_RETURN_ATTEMPT_PARAM,
  navigateConnectorPopup,
  type ConnectorPopupAttempt,
} from './providerReturnBridge'
import type { Account, AppState, CreditCardDetails, Transaction } from './types'

export type ConnectorProvider = 'enablebanking' | 'gocardless' | 'finapi' | 'paypal'
export type ConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
export type ConnectorAccountType = 'checking' | 'savings' | 'credit-card' | 'investment'
const CONNECTOR_PROVIDERS: ReadonlySet<string> = new Set<ConnectorProvider>(['enablebanking', 'gocardless', 'finapi', 'paypal'])

// Recovers the provider a connector-imported Account belongs to from its id
// (buildSyncPreview() always mints `connector:${provider}:${externalId}`).
// Returns undefined for a manual account (any id not in that shape) --
// used by Dashboard's "Remove account" action to decide whether removal
// also needs excludeProviderAccount(), never by anything security-relevant
// (the server independently derives its own provider/stableId pairing; this
// is purely a UI convenience for routing the right follow-up call).
export function connectorProviderFromAccountId(accountId: string): ConnectorProvider | undefined {
  const provider = accountId.startsWith('connector:') ? accountId.slice('connector:'.length).split(':')[0] : undefined
  return provider && CONNECTOR_PROVIDERS.has(provider) ? provider as ConnectorProvider : undefined
}

export interface ConnectorStartContext {
  institutionId?: string
  institutionName?: string
  accountType?: ConnectorAccountType
}

// A previously-excluded stable account, surfaced so "Remove account" is
// never an irreversible hidden tombstone -- see restoreProviderAccount()
// and the Connections page's "Removed from Finance Planner [Restore]" row.
export interface ExcludedAccountSummary { stableAccountId: string; accountName?: string; createdAt: string }
export interface ConnectorConnection { id: string; provider: ConnectorProvider; displayName: string; status: ConnectorStatus; lastSyncAt?: string; consentExpiresAt?: string; institutionId?: string; error?: string; excludedAccounts?: ExcludedAccountSummary[] }
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
  // Server-derived, provider-agnostic identity for the same real-world
  // account across separate sessions/consents -- see the matching doc
  // comment on Account.stableId in src/domain/finance/types.ts and
  // stableAccountId() in server/src/providers.js. Undefined when the
  // provider offered no trustworthy stable identifier for this account.
  stableId?: string
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
export interface ExternalTransaction {
  externalId: string
  externalAccountId: string
  // Server-derived identity for the same real transaction across a
  // reconnect -- see the matching doc comment on Transaction.stableTransactionId
  // and stableTransactionId() in server/src/providers.js. Undefined when no
  // provider-documented bank-assigned reference was available.
  stableTransactionId?: string
  description: string
  category?: string
  amountCents: number
  currency: 'EUR'
  bookingDate: string
  pending?: boolean
}
export interface SyncPayload { connection: ConnectorConnection; accounts: ExternalAccount[]; transactions: ExternalTransaction[] }
export interface SyncPreview {
  accountsToCreate: Account[]
  // Accounts matched to an ALREADY-existing Finance Planner account via
  // stable identity (a reconnect under a new provider session/externalId,
  // see buildSyncPreview()) -- their externalId/balance/metadata is
  // refreshed in place under the original account id, never duplicated.
  // Found live 2026-08-26/27 (PR #154, seventh Mock ASPSP pass): without
  // this, a reconnect minted a new account id and doubled every historical
  // transaction on top of it.
  accountsToUpdate: Account[]
  transactionsToImport: Transaction[]
  duplicateCount: number
  pendingCount: number
  quality: BankImportQuality
}

// startConnector()'s result. In production, provider authorization always
// moves into a separate popup so the already-unlocked Finance Planner tab is
// never unloaded and its in-memory vault key remains intact. The popup
// return is bridged back through providerReturnBridge.ts and the existing
// callback/sync UI is remounted by ConnectionsPanel. If the browser blocks
// the popup, or a tab-local return binding cannot be created, startConnector
// fails closed (see below) -- it never falls back to an embedded widget or a
// same-tab redirect in production, since either would risk unloading the
// document and destroying the memory-only vault key. Acceptance fixtures are
// the one exception: they skip real popups entirely and exercise the
// embedded-auth/redirect result shapes deterministically. No vault
// password/key is persisted to achieve any of this.
//
// 'popup' is distinct from 'redirect': for 'redirect', the CURRENT tab is
// about to navigate away (nothing left to do here). For 'popup', the
// current tab's document is untouched and stays fully interactive -- a
// caller that treated 'popup' the same as 'redirect' would be left showing
// a permanently "busy" UI with no further progress, since no navigation in
// this tab is ever coming (fixed 2026-08-25; see ConnectionsPage.tsx's
// startProvider()). The full ConnectorPopupAttempt (not just the bare
// Window) is included so a caller can call abandonConnectorPopupAttempt(attempt)
// to cancel cleanly. Deliberately NOT so a caller can poll `attempt.popup.closed`
// to detect a manual close: this app's COOP policy (`same-origin`, see
// server/src/server.js) severs the opener's WindowProxy reference once the
// popup navigates cross-origin to the real provider, so `.closed` can read
// `true` while the authorization window is genuinely still open (fixed
// 2026-08-25, see ConnectionsPage.tsx's removed polling effect and its
// PopupWaitingStep component).
export type ConnectorStartResult =
  | { mode: 'redirect' }
  | { mode: 'popup'; attempt: ConnectorPopupAttempt }
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
  const accountMap = new Map<string, string>(); const accountsToCreate: Account[] = []; const accountsToUpdate: Account[] = []
  // Found by adversarial review (2026-08-27): without tracking which
  // existing Finance Planner account ids this sync has already matched,
  // two DIFFERENT external accounts that happen to share one stableId
  // (e.g. GoCardless is documented to expose sub-accounts sharing a single
  // IBAN for some banks) would BOTH match the same existing account below
  // and collapse two distinct real accounts' transactions into one Finance
  // Planner account -- the exact class of financial-data-corruption bug
  // this reconnect fix exists to prevent, approached from the opposite
  // direction. Once an existing account id is claimed (by id or by
  // stableId) for this sync, a second external account cannot also claim
  // it -- it falls through to creating its own new account instead, never
  // a merge.
  const claimedAccountIds = new Set<string>()
  // Which existing Finance Planner account ids were matched via stableId
  // THIS sync (a genuine reconnect, not a routine same-session re-sync).
  // Read by the transaction loop below: only for these accounts does the
  // fuzzy date/amount/description fingerprint fallback get skipped (see
  // its doc comment there for why).
  const reconnectedAccountIds = new Set<string>()
  for (const external of payload.accounts) {
    const deterministicId = `connector:${payload.connection.provider}:${external.externalId}`
    const existingById = state.accounts.find((account) => account.id === deterministicId)
    if (existingById) { accountMap.set(external.externalId, deterministicId); claimedAccountIds.add(deterministicId); continue }
    // Reconnect reconciliation (found live 2026-08-26/27, PR #154, seventh
    // Mock ASPSP pass): the provider-session externalId above changes on
    // reauthorization, so it alone can never detect "this is the same real
    // account I already imported." stableId is a provider-agnostic identity
    // for the same real-world account across sessions (see
    // ExternalAccount.stableId / Account.stableId) -- when it matches an
    // account already in state, this is a reconnect, not a new account:
    // reuse the EXISTING Finance Planner account id (so transaction
    // fingerprinting below naturally dedupes against its history) and
    // refresh its externalId/balance/metadata in place rather than creating
    // a second account. No stableId on either side -> no unsafe automatic
    // merge; falls through to a normal new-account create, exactly like
    // before this fix.
    const reconnected = external.stableId
      ? state.accounts.find((account) => account.stableId && account.stableId === external.stableId && !claimedAccountIds.has(account.id))
      : undefined
    const normalized = normalizeCreditCard(external)
    if (reconnected) {
      accountMap.set(external.externalId, reconnected.id)
      claimedAccountIds.add(reconnected.id)
      reconnectedAccountIds.add(reconnected.id)
      accountsToUpdate.push({
        ...reconnected,
        externalId: external.externalId,
        stableId: external.stableId ?? reconnected.stableId,
        institutionId: external.institutionId ?? reconnected.institutionId,
        balanceCents: normalized.balanceCents,
        lastSyncedAt: new Date().toISOString(),
        creditCard: normalized.creditCard,
      })
      continue
    }
    accountMap.set(external.externalId, deterministicId)
    claimedAccountIds.add(deterministicId)
    accountsToCreate.push({
      id: deterministicId,
      externalId: external.externalId,
      stableId: external.stableId,
      institutionId: external.institutionId,
      name: external.name,
      type: external.type,
      balanceCents: normalized.balanceCents,
      currency: 'EUR',
      lastSyncedAt: new Date().toISOString(),
      creditCard: normalized.creditCard,
    })
  }
  // Found live 2026-08-27 (PR #154, reconnect-dedup follow-up, independent
  // review): the pre-existing fuzzy fingerprint (accountId + date +
  // amountCents + normalized description) was being relied on as the DE
  // FACTO reconnect-dedup key once a reconnected account's transactions
  // shared its (reused) account id with history -- but that fingerprint can
  // collapse two GENUINELY DIFFERENT same-day/same-amount/same-description
  // transactions (e.g. two identical REWE purchases), which is exactly the
  // "do not collapse two legitimate transactions" requirement this whole
  // fix must not violate.
  //
  // knownStableIds is checked FIRST and is authoritative when present
  // (exact match only, never fuzzy) -- see stableTransactionId() in
  // providers.js. The fuzzy fingerprint fallback is now used ONLY for
  // accounts that were NOT reconnected this sync (the routine, same-session
  // case, where account/transaction identity hasn't changed and this
  // fallback has worked adequately -- pre-existing behavior, unchanged). A
  // reconnected account's transaction with no stableTransactionId is
  // imported rather than risking a silent false-duplicate -- conservative
  // by design, per the explicit requirement to prefer import over silently
  // losing a real transaction.
  const knownFingerprints = new Set(state.transactions.map(transactionFingerprint))
  const knownStableTransactionIds = new Set(state.transactions.filter((transaction) => transaction.stableTransactionId).map((transaction) => transaction.stableTransactionId))
  const transactionsToImport: Transaction[] = []; let duplicateCount = 0; let pendingCount = 0; let smartCategorized = 0
  for (const external of payload.transactions) {
    if (external.currency !== 'EUR') continue
    if (external.pending) { pendingCount += 1; continue }
    const accountId = accountMap.get(external.externalAccountId); if (!accountId) continue
    const description = normalizeDescription(external.description)
    const learned = external.category?.trim() ? null : suggestCategoryFromHistory(description, state.transactions)
    const category = external.category?.trim() || learned?.category || 'Unkategorisiert'
    const transaction: Transaction = { id: `connector:${payload.connection.provider}:${external.externalId}`, accountId, description, category, type: external.amountCents >= 0 ? 'income' : 'expense', amountCents: Math.abs(external.amountCents), date: external.bookingDate, recurring: false, stableTransactionId: external.stableTransactionId }
    if (state.transactions.some((item) => item.id === transaction.id)) { duplicateCount += 1; continue }
    if (external.stableTransactionId) {
      if (knownStableTransactionIds.has(external.stableTransactionId)) { duplicateCount += 1; continue }
      knownStableTransactionIds.add(external.stableTransactionId)
    } else if (!reconnectedAccountIds.has(accountId)) {
      const fingerprint = transactionFingerprint(transaction)
      if (knownFingerprints.has(fingerprint)) { duplicateCount += 1; continue }
      knownFingerprints.add(fingerprint)
    }
    transactionsToImport.push(transaction)
    if (learned) smartCategorized += 1
  }
  return { accountsToCreate, accountsToUpdate, transactionsToImport, duplicateCount, pendingCount, quality: assessBankImportQuality(transactionsToImport, smartCategorized) }
}

export function selectSyncPreviewAccounts(preview: SyncPreview, selectedAccountIds: Iterable<string>): SyncPreview {
  const selected = new Set(selectedAccountIds)
  const accountsToCreate = preview.accountsToCreate.filter((account) => selected.has(account.id))
  const accountsToUpdate = preview.accountsToUpdate.filter((account) => selected.has(account.id))
  const allowed = new Set([...accountsToCreate, ...accountsToUpdate].map((account) => account.id))
  const transactionsToImport = preview.transactionsToImport.filter((transaction) => allowed.has(transaction.accountId))
  return { ...preview, accountsToCreate, accountsToUpdate, transactionsToImport }
}

export function applySyncPreview(state: AppState, preview: SyncPreview): AppState {
  const updates = new Map(preview.accountsToUpdate.map((account) => [account.id, account]))
  return {
    ...state,
    accounts: [...state.accounts.map((account) => updates.get(account.id) ?? account), ...preview.accountsToCreate],
    transactions: [...preview.transactionsToImport, ...state.transactions],
  }
}

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
// Fixed 2026-08-27 (PR #154, seventh Mock ASPSP pass): a normal Connections
// page mount had no way to learn an already-persisted connector connection
// existed without running a full provider synchronization -- ConnectionsPage
// held `connections` as local React state, destroyed on unmount, and
// fetchProviderStatus() above only ever returns provider descriptors
// (available/configured), never the user's own stored rows. This reads the
// same bounded, secret-free connection summary buildSyncPayload() already
// returns after a sync, but without contacting any provider network API.
export async function fetchStoredConnections(): Promise<ConnectorConnection[]> {
  const result = await requestJson<{ connections?: ConnectorConnection[] }>('/api/connectors/connections', { method: 'GET' }, { retry: true })
  if (!Array.isArray(result.connections)) throw new Error('The stored connections response was invalid.')
  return result.connections
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
  //
  // Fixed 2026-08-25 (production invariant, not just a UX nicety):
  // beginConnectorPopupAttempt() throws when the browser blocks the popup or
  // can't create the sessionStorage return binding. In production that throw
  // must propagate out of startConnector() BEFORE /start is ever contacted --
  // /start creates a provider authorization nonce, and this function's only
  // safe way to consume a redirect it returns is to hand it to a popup that
  // never unloads this document. Catching this failure and falling through
  // to /start would (re)create the exact regression this bridge exists to
  // fix: a same-tab redirect (or, previously, the embedded widget) that
  // unloads the SPA and destroys the memory-only, non-extractable vault key,
  // forcing an unnecessary re-unlock on return. So there is deliberately no
  // try/catch here outside acceptance-fixture mode -- popup creation failure
  // is a fail-closed, retryable start failure, not a silent fallback.
  let popupAttempt: ConnectorPopupAttempt | null = null
  if (import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true') {
    popupAttempt = beginConnectorPopupAttempt(provider)
  }
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
    // 'popup', not 'redirect': the current tab isn't navigating anywhere.
    if (popupAttempt) {
      navigateConnectorPopup(popupAttempt, result.redirectUrl)
      return { mode: 'popup', attempt: popupAttempt }
    }

    const authFlow = result.authFlow
    // popupAttempt is only ever null here in acceptance-fixture mode (a real
    // popup-creation failure above already rejected before /start was
    // called), so this embedded-widget/same-tab-redirect branch only runs
    // under the deterministic test harness, never in production. Every field
    // is still re-validated here, client-side, even though the server
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
// Records that this stable account should no longer be re-imported on
// future syncs of this connection -- persisted durably, independent of the
// live connector credential (see server/src/account-exclusions.js and
// migration 011), so it survives disconnect/reconnect of the same bank.
//
// Fixed 2026-08-27 (independent review, BLOCKER 2): this is now a required,
// awaited step of removal, never fire-and-forget -- the caller (App.tsx's
// removeAccount()) MUST await this and only remove the account from local
// AppState after it resolves. A failure here must propagate (this function
// deliberately does NOT swallow it) so the caller can keep the account
// visible and show an actionable error instead of silently promising a
// removal that a later sync could undo.
export async function excludeProviderAccount(provider: ConnectorProvider, stableAccountId: string, accountName?: string): Promise<void> {
  await requestJson<{ excluded?: boolean }>(`/api/connectors/${provider}/exclusions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stableAccountId, accountName }),
  }, { idempotent: true })
}
// Restore ("un-remove") a previously-excluded provider account -- see
// ExcludedAccountSummary. Only deletes the durable exclusion record; it
// never resurrects old local transactions by guessing -- a subsequent
// normal synchronization is what actually brings the account back through
// the reviewed import path.
export async function restoreProviderAccount(provider: ConnectorProvider, stableAccountId: string): Promise<void> {
  await requestJson<{ restored?: boolean }>(`/api/connectors/${provider}/exclusions/${encodeURIComponent(stableAccountId)}`, { method: 'DELETE' }, { idempotent: true })
}
export function consentDaysRemaining(connection: ConnectorConnection, now = Date.now()): number | null { if (!connection.consentExpiresAt) return null; const expiresAt = Date.parse(connection.consentExpiresAt); if (!Number.isFinite(expiresAt)) return null; return Math.ceil((expiresAt - now) / 86_400_000) }
