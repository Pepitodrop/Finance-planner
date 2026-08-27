import { createHmac } from 'node:crypto'
import { assessBankConnectionHealth, chooseBankSyncBackoff } from './bank-sync-health.js'
import { CobolBankingCore } from './cobol-banking-core.js'
import { normalizeSignedAmount } from './cobol-engine.js'
import { isEnableBankingConfigured, signEnableBankingJwt } from './enable-banking-jwt.js'
import { HttpError } from './runtime-security.js'

const GC_BASE = 'https://bankaccountdata.gocardless.com/api/v2'
const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com'
const PAYPAL_LIVE = 'https://api-m.paypal.com'
const EB_BASE = 'https://api.enablebanking.com'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const DEFAULT_SYNC_DAYS = 31
const DEFAULT_OVERLAP_DAYS = 3
const GOCARDLESS_CONSENT_DAYS = 90
const ENABLEBANKING_DEFAULT_CONSENT_DAYS = 90
const CONSENT_EXPIRY_SAFETY_MS = 5 * 60_000
const MAX_PAYPAL_PAGES = 100
const MAX_ENABLEBANKING_PAGES = 100
const MAX_RETRY_DELAY_MS = 30_000
const INSTITUTIONS_CACHE_TTL_MS = 10 * 60_000
const LOGO_CACHE_TTL_MS = 24 * 60 * 60_000
const LOGO_CACHE_MAX_ENTRIES = 500
const LOGO_FETCH_TIMEOUT_MS = 5_000
const LOGO_MAX_REDIRECTS = 3
const LOGO_MAX_BYTES = 2 * 1024 * 1024
// Raster formats only -- no `image/svg+xml`. An SVG served with this exact
// content-type executes embedded <script>/event-handler markup if a browser
// is ever navigated to the logo URL directly as a top-level document (a
// real, well-known behavior distinct from the safe, script-disabled
// rendering an <img> tag gets); sanitizing SVG correctly is its own
// nontrivial project. Excluding the format entirely is the safe-by-default
// choice here -- a bank whose only logo is SVG-only just falls through to
// the lettermark, never to a rejected/broken image.
const LOGO_CONTENT_TYPE_ALLOWLIST = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const READ_ONLY_CAPABILITIES = Object.freeze({
  accountInformation: true,
  balances: true,
  transactions: true,
  paymentInitiation: false,
  transfers: false,
  payouts: false,
  orders: false,
  mandates: false,
})

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10) }

function createBankingCore(env) {
  return new CobolBankingCore({
    binary: env.COBOL_BANKING_BINARY,
    required: env.COBOL_BANKING_REQUIRED === 'true',
  })
}

function paypalMode(env) {
  const configured = String(env.PAYPAL_CONNECTION_MODE || '').trim().toLowerCase()
  if (configured) {
    if (!['owner', 'partner'].includes(configured)) throw new Error('PAYPAL_CONNECTION_MODE must be owner or partner.')
    return configured
  }
  return env.PAYPAL_PARTNER_MERCHANT_ID ? 'partner' : 'owner'
}

export async function normalizeProviderAccountType(account, env = {}, suppliedCore) {
  const core = suppliedCore || createBankingCore(env)
  if (typeof core.normalizeProviderAccountType !== 'function') {
    throw new Error('The COBOL banking core does not expose provider account normalization.')
  }
  const code = String(account?.cashAccountType || account?.type || '')
  return core.normalizeProviderAccountType(code)
}

export function retryDelayMs(value, now = Date.now()) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
  const date = Date.parse(value)
  if (!Number.isFinite(date)) return null
  return Math.min(Math.max(0, date - now), MAX_RETRY_DELAY_MS)
}

export function syncWindow(lastSyncedAt, now = new Date(), fallbackDays = DEFAULT_SYNC_DAYS, overlapDays = DEFAULT_OVERLAP_DAYS) {
  const end = new Date(now)
  if (!Number.isFinite(end.getTime())) throw new Error('Invalid synchronization time.')
  const fallback = new Date(end.getTime() - fallbackDays * 86_400_000)
  const previous = lastSyncedAt ? new Date(lastSyncedAt) : fallback
  const safePrevious = Number.isFinite(previous.getTime()) && previous <= end ? previous : fallback
  const start = new Date(Math.max(fallback.getTime(), safePrevious.getTime() - overlapDays * 86_400_000))
  return { start, end, dateFrom: isoDate(start), dateTo: isoDate(end) }
}

export function gocardlessConsentExpiresAt(credential) {
  const source = credential?.connectedAt || credential?.createdAt || credential?.consentGrantedAt
  const issuedAt = Date.parse(source)
  if (!Number.isFinite(issuedAt)) return null
  const days = Number(credential?.accessValidForDays || GOCARDLESS_CONSENT_DAYS)
  if (!Number.isInteger(days) || days < 1 || days > 180) throw new Error('GoCardless consent duration is invalid.')
  return new Date(issuedAt + days * 86_400_000).toISOString()
}

export function validateProviderReconciliation({ accounts, transactions, reconciliation }) {
  if (!Array.isArray(accounts) || !Array.isArray(transactions) || !reconciliation || typeof reconciliation !== 'object') {
    throw new Error('Provider reconciliation payload is incomplete.')
  }
  if (reconciliation.accountCount !== undefined && reconciliation.accountCount !== accounts.length) {
    throw new Error('Provider reconciliation account count does not match normalized accounts.')
  }
  if (reconciliation.transactionCount !== transactions.length) {
    throw new Error('Provider reconciliation transaction count does not match normalized transactions.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(reconciliation.dateFrom || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(reconciliation.dateTo || ''))) {
    throw new Error('Provider reconciliation date window is invalid.')
  }
  if (reconciliation.dateFrom > reconciliation.dateTo) throw new Error('Provider reconciliation date window is reversed.')
  const ids = new Set()
  for (const transaction of transactions) {
    const externalId = String(transaction?.externalId || '')
    if (!externalId || ids.has(externalId)) throw new Error('Provider reconciliation contains a duplicate or empty transaction identifier.')
    ids.add(externalId)
    if (!Number.isSafeInteger(transaction.amountCents)) throw new Error('Provider reconciliation contains an unsafe transaction amount.')
    if (transaction.currency !== 'EUR') throw new Error('Provider reconciliation contains a non-EUR transaction.')
  }
  return true
}

async function validateProviderReconciliationWithCore(core, payload) {
  validateProviderReconciliation(payload)
  if (typeof core.validateProviderReconciliation !== 'function') {
    throw new Error('The COBOL banking core does not expose provider reconciliation validation.')
  }
  const uniqueTransactionCount = new Set(payload.transactions.map((transaction) => transaction.externalId)).size
  await core.validateProviderReconciliation({
    accountCount: payload.accounts.length,
    reconciledAccountCount: payload.reconciliation.accountCount ?? payload.accounts.length,
    transactionCount: payload.transactions.length,
    uniqueTransactionCount,
    dateFrom: payload.reconciliation.dateFrom,
    dateTo: payload.reconciliation.dateTo,
  })
  return true
}

export async function jsonFetch(url, options = {}, policy = {}) {
  const timeoutMs = Number(policy.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const retries = Number(policy.retries ?? DEFAULT_RETRIES)
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error('Provider timeout is invalid.')
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw new Error('Provider retry count is invalid.')
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const text = await response.text()
      let body = {}
      if (text) {
        try { body = JSON.parse(text) } catch { body = {} }
      }
      if (response.ok) return body

      const error = new Error(`Provider request failed with HTTP ${response.status}.`)
      error.status = response.status
      // Safe to attach: this is the provider's OWN returned error payload,
      // never anything Finance Planner sent (JWTs/private keys are outgoing
      // auth headers, never echoed back in a response body). Only consumed
      // by server.js's structured request-error log (never returned to the
      // client -- classifyError() keeps the generic client-facing message)
      // so a provider-contract rejection (e.g. an invalid POST /auth body)
      // is diagnosable from logs instead of surfacing as a bare, silent
      // "Internal server error" with no actionable detail.
      const providerCode = typeof body?.error === 'string' ? body.error : (typeof body?.code === 'string' ? body.code : undefined)
      const providerMessage = typeof body?.message === 'string' ? body.message : (typeof body?.error_description === 'string' ? body.error_description : undefined)
      if (providerCode) error.providerCode = providerCode
      if (providerMessage) error.providerMessage = String(providerMessage).slice(0, 300)
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === retries) throw error

      lastError = error
      const providerDelay = retryDelayMs(response.headers.get('retry-after'))
      await sleep(chooseBankSyncBackoff(attempt, providerDelay))
      continue
    } catch (error) {
      lastError = error
      const retryableNetworkError = error?.name === 'AbortError' || error instanceof TypeError
      if (retryableNetworkError && attempt < retries) {
        await sleep(chooseBankSyncBackoff(attempt))
        continue
      }
      break
    } finally {
      clearTimeout(timer)
    }
  }

  if (lastError?.name === 'AbortError') throw new Error(`Provider request timed out after ${timeoutMs}ms`)
  throw lastError ?? new Error('Provider request failed')
}

// Fetches a bank/group logo image from a provider-supplied URL, bounded and
// re-validated at every hop -- the "browser -> same-origin logo endpoint ->
// server re-validates institution -> server obtains the logo URL from that
// trusted provider response -> validate -> bounded fetch -> serve from
// Finance Planner's own origin" architecture (see server.js's logo route).
// `initialUrl` must already have been produced by a provider-specific
// validator (HTTPS + exact allowed hostname) BEFORE this is ever called --
// this function re-validates every redirect target the same way, but is not
// itself the source of truth for which hostnames are allowed. Never forwards
// cookies/credentials/auth headers upstream, never follows a redirect off
// the allowed hostname, never returns more than LOGO_MAX_BYTES, and only
// returns a raster image whose Content-Type is on the fixed allowlist.
// Races a promise against a hard deadline without relying on the promise's
// own cancellation semantics -- used for both the initial fetch() and every
// reader.read() call below. Deliberately NOT just an AbortController signal
// passed to fetch(): that only reliably bounds the time until response
// headers arrive. Whether aborting it ALSO unblocks an in-flight
// `reader.read()` on the response body is an implementation detail of the
// fetch runtime rather than something this code should depend on for its
// own timeout guarantee (found by an independent security review pass,
// 2026-08-21: the original code cleared its timer as soon as fetch()
// resolved, leaving the body-read loop with no deadline at all -- a server
// that returns 200 + valid headers, sends a few bytes, then stalls the
// connection without closing it hung this function, and the request thread
// serving it, indefinitely). This race is the actual, explicit bound;
// `signal` is still passed to fetch() as a real, additional layer that lets
// a well-behaved runtime tear down the underlying connection promptly, but
// nothing here depends on it doing so.
function withDeadline(promise, deadlineAt, onTimeout) {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) return Promise.reject(new Error('Deadline already passed.'))
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new Error('Operation timed out.')) }, remaining)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function fetchBoundedImage(initialUrl, { allowedHostnames, timeoutMs = LOGO_FETCH_TIMEOUT_MS, maxBytes = LOGO_MAX_BYTES, maxRedirects = LOGO_MAX_REDIRECTS } = {}) {
  // One deadline for the WHOLE call, not reset per redirect hop -- a chain
  // of otherwise-individually-fast redirects must not add up to
  // maxRedirects * timeoutMs of total latency (found by the same review
  // pass as the read-loop timeout above).
  const deadline = Date.now() + timeoutMs
  let currentUrl = initialUrl
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    let parsed
    try { parsed = new URL(currentUrl) } catch { return null }
    if (parsed.protocol !== 'https:' || !allowedHostnames.has(parsed.hostname)) return null

    const controller = new AbortController()
    let response
    try {
      response = await withDeadline(
        fetch(currentUrl, { signal: controller.signal, redirect: 'manual', credentials: 'omit', headers: { Accept: 'image/*' } }),
        deadline,
        () => controller.abort(),
      )
    } catch {
      return null
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) return null
      try { currentUrl = new URL(location, currentUrl).toString() } catch { return null }
      continue // loop re-validates protocol/hostname on the new URL before ever fetching it
    }
    if (!response.ok) return null

    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (!LOGO_CONTENT_TYPE_ALLOWLIST.has(contentType)) return null
    const declaredLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null

    const reader = response.body?.getReader()
    if (!reader) return null
    const chunks = []
    let total = 0
    try {
      for (;;) {
        // Deliberately no onTimeout callback here (unlike the fetch() call
        // below): ReadableStreamDefaultReader.cancel() *resolves* a pending
        // read() (as {done: true}) rather than rejecting it, so calling it
        // from inside the timeout race would compete with the timeout's own
        // rejection for which one Promise.race observes first -- a genuine,
        // order-of-microtasks-dependent race that isn't worth the fragility.
        // The reader is cancelled unconditionally in the catch block below
        // once the deadline has already won cleanly, which is enough to
        // stop the stream and avoid leaving its underlying resource pinned.
        const { done, value } = await withDeadline(reader.read(), deadline)
        if (done) break
        total += value.byteLength
        // Defense in depth against a Content-Length that under-reports (or
        // is absent) -- the actual byte stream is bounded regardless of
        // what the provider claims, and regardless of whether it was
        // transparently decompressed by the fetch implementation.
        if (total > maxBytes) { await reader.cancel().catch(() => {}); return null }
        chunks.push(value)
      }
    } catch {
      await reader.cancel().catch(() => {}) // covers the read loop hitting the deadline too
      return null
    }
    return { contentType, body: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) }
  }
  return null // exceeded maxRedirects without landing on a usable response
}

function providerPolicy(env) {
  return {
    timeoutMs: Number(env.PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    retries: Number(env.PROVIDER_RETRIES || DEFAULT_RETRIES),
  }
}

function tokenIsUsable(token, now = Date.now()) {
  if (!token?.access) return false
  if (!token.accessExpiresAt) return true
  return Date.parse(token.accessExpiresAt) - now >= 120_000
}

// Found live 2026-08-26/27 (PR #154, seventh Mock ASPSP pass): account
// identity was keyed only to a provider-session-scoped externalId (Enable
// Banking's `uid`, valid only while that session is AUTHORIZED), so a
// reconnect of the same real bank account minted a brand-new Finance
// Planner account id, and every historical transaction re-imported under
// it -- doubling balances/totals instead of deduplicating.
//
// This derives a deterministic, provider-agnostic stable identity for the
// same real-world account across separate sessions/consents, from a raw
// provider-supplied identifier documented as stable across reauthorization
// (Enable Banking's `identification_hash`, itself already a hash of the
// account number, never the account number itself; GoCardless's IBAN).
// Keyed with CONNECTOR_MASTER_KEY -- the same secret this codebase already
// trusts to encrypt every provider credential -- so the value that ever
// reaches ExternalAccount.stableId (and, from there, the browser and
// Finance Planner's own encrypted cloud state) is a fresh HMAC digest, not
// the provider's own hash and never a raw account number. Returns undefined
// (never throws) when the raw identifier or the master key is unavailable,
// so a sync with no trustworthy stable identity for an account degrades to
// the pre-existing externalId-only identity path rather than fabricating
// one -- see buildSyncPreview() in src/connectors.ts for the "no unsafe
// automatic merge without a match" contract this feeds.
export const STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN = /^[A-Za-z0-9+/=_-]{1,256}$/
const STABLE_ACCOUNT_ID_SHAPE = /^[a-f0-9]{64}$/

function hmacDigest(env, message) {
  const secret = env.CONNECTOR_MASTER_KEY
  if (typeof secret !== 'string' || secret.length < 32) return undefined
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

export function stableAccountId(env, provider, rawIdentifier) {
  if (typeof rawIdentifier !== 'string' || !STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN.test(rawIdentifier)) return undefined
  return hmacDigest(env, `${provider}:${rawIdentifier}`)
}

// Found live 2026-08-27 (PR #154, reconnect-dedup follow-up, independent
// review): the reconnect fix reused transactionFingerprint() (accountId +
// date + amountCents + description) as its de facto reconnect-dedup key,
// which can collapse two GENUINELY DIFFERENT same-day/same-amount/same-
// description transactions (e.g. two identical REWE purchases). Neither
// Enable Banking's entry_reference nor GoCardless's transactionId is
// documented as stable across sessions/requisitions the way the account-
// level identification_hash/iban is -- but both ARE described as assigned
// by the financial institution itself, not by the session, which is the
// same structural property already relied on for account-level stability.
// Namespacing that bank-assigned reference under the account's own proven-
// stable identity (never the session-scoped account/requisition id) is
// what turns it into a meaningfully more trustworthy cross-reconnect key
// than before, without claiming a documented guarantee that doesn't exist.
// Deliberately a SEPARATE function from stableAccountId() (not reused with
// a colon-joined composite string) because the composite
// `${accountStableId}:${reference}` would itself fail
// STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN (no ':' in that charset) --
// accountStableId's shape is validated directly here instead.
export function stableTransactionId(env, provider, accountStableId, transactionReference) {
  if (typeof accountStableId !== 'string' || !STABLE_ACCOUNT_ID_SHAPE.test(accountStableId)) return undefined
  if (typeof transactionReference !== 'string' || !STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN.test(transactionReference)) return undefined
  return hmacDigest(env, `${provider}:${accountStableId}:${transactionReference}`)
}

function completedHealth({ completedAt, consentExpiresAt = null, accounts, transactions }) {
  const externalIds = transactions.map((transaction) => transaction.externalId)
  const duplicateCount = externalIds.length - new Set(externalIds).size
  const health = assessBankConnectionHealth({
    consentExpiresAt,
    lastSyncedAt: completedAt.toISOString(),
    consecutiveFailures: 0,
    accountCount: accounts.length,
    reconciledAccountCount: accounts.length,
    transactionCount: transactions.length,
    pendingTransactionCount: transactions.filter((transaction) => transaction.pending).length,
    duplicateTransactionCount: duplicateCount,
  }, completedAt)
  if (!health.importAllowed) throw new Error(`Provider synchronization blocked by health policy: ${health.reasons.join(',') || health.state}`)
  return health
}

export class OpenBankingProvider {
  constructor({ id, displayName, kind, env, core, capabilities = READ_ONLY_CAPABILITIES }) {
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) throw new Error('Provider ID is invalid.')
    this.id = id
    this.displayName = displayName || id
    this.kind = kind
    this.env = env
    this.core = core || createBankingCore(env)
    this.capabilities = Object.freeze({ ...READ_ONLY_CAPABILITIES, ...capabilities })
    if (Object.values({
      paymentInitiation: this.capabilities.paymentInitiation,
      transfers: this.capabilities.transfers,
      payouts: this.capabilities.payouts,
      orders: this.capabilities.orders,
      mandates: this.capabilities.mandates,
    }).some(Boolean)) throw new Error(`${id} attempts to enable forbidden money movement.`)
  }

  isAvailable() { return true }
  isConfigured() { return false }
  webhookRequired() { return false }
  async start() { throw new Error(`${this.id} provider start is not implemented.`) }
  async sync() { throw new Error(`${this.id} provider sync is not implemented.`) }
  async institutionDirectory() { throw new HttpError(404, 'institution_directory_unsupported', `${this.id} does not provide an institution directory.`) }
  // Fetches a bounded, validated logo image for a given institutionId
  // (re-derived from the live directory server-side, never trusting a
  // client-supplied URL) and returns { contentType, body } or null when no
  // logo is available -- never a hard error, since "no logo" is the normal
  // case for most providers/institutions and the frontend already has a
  // lettermark fallback. See server.js's logo route and
  // EnableBankingProvider's override for the concrete implementation.
  async fetchInstitutionLogo() { return null }
  // Called by the server callback route AFTER its own state/nonce verification
  // succeeds, with the already-consumed pending credential and whatever
  // provider-specific data the callback URL carried (e.g. an authorization
  // code). Providers whose entire credential is already known at start() time
  // (GoCardless, PayPal) don't need to do anything here -- this identity
  // pass-through covers them. Enable Banking overrides this to exchange the
  // code server-side via POST /sessions before the connection can be
  // finalized. Never called until the nonce is already consumed; the pending
  // credential this returns is what gets promoted into connector_connections
  // by store.finalizeConnection() -- see server.js's callback route.
  async completeCallback({ pending }) { return pending }
  // Best-effort provider-side revocation on disconnect. Never assumed --
  // callers must not report a connection as provider-revoked unless this
  // resolves { revoked: true }. Base implementation covers providers with no
  // per-connection token/consent to revoke.
  async disconnect() { return { revoked: false, reason: 'not_supported' } }

  describe() {
    return {
      id: this.id,
      displayName: this.displayName,
      kind: this.kind,
      available: this.isAvailable(),
      configured: this.isConfigured(),
      webhookRequired: this.webhookRequired(),
      capabilities: this.capabilities,
    }
  }
}

export class OpenBankingProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map()
    for (const provider of providers) this.register(provider)
  }

  register(provider) {
    if (!(provider instanceof OpenBankingProvider)) throw new Error('Provider must implement OpenBankingProvider.')
    if (this.providers.has(provider.id)) throw new Error(`Provider ${provider.id} is already registered.`)
    this.providers.set(provider.id, provider)
    return this
  }

  get(id) {
    const provider = this.providers.get(id)
    if (!provider) throw new Error(`Unknown open-banking provider: ${id}`)
    return provider
  }

  list() { return [...this.providers.values()].map((provider) => provider.describe()) }
  adapters() { return [...this.providers.values()] }
  configured() { return this.list().filter((provider) => provider.available && provider.configured) }
}

export async function gocardlessToken(env) {
  const token = await jsonFetch(`${GC_BASE}/token/new/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: env.GOCARDLESS_SECRET_ID, secret_key: env.GOCARDLESS_SECRET_KEY }),
  }, providerPolicy(env))
  if (!token?.access) throw new Error('GoCardless did not return an access token.')
  const issuedAt = new Date()
  return {
    ...token,
    issuedAt: issuedAt.toISOString(),
    accessExpiresAt: Number(token.access_expires) > 0 ? new Date(issuedAt.getTime() + Number(token.access_expires) * 1000).toISOString() : undefined,
  }
}

// Builds the address a provider redirects the browser to after consent --
// always our own /api/connectors/callback route (never the raw client
// redirectUri), so every provider's return is verified through the same
// signed-state/nonce-consumption path (verifyState + consumePendingConnectionSetup)
// instead of each adapter inventing its own return-detection contract.
function callbackUrl(redirectUri, provider, state) {
  const callback = new URL('/api/connectors/callback', new URL(redirectUri).origin)
  callback.searchParams.set('provider', provider)
  callback.searchParams.set('state', state)
  return callback
}

// The PROVIDER CALLBACK URI, as distinct from the application-return
// destination the browser separately supplies (`redirectUri` -- what the
// two-argument callbackUrl() above is built from, and what ends up as
// `state.redirectUri`, used only AFTER a successful callback to send the
// user back to their own Finance Planner page). Fixed 2026-08-21 after a
// live REDIRECT_URI_NOT_ALLOWED rejection from Enable Banking's real
// sandbox: their Control Panel validates the submitted `redirect_url` as
// an exact, bare string against its registered allow-list -- appending
// `?provider=...&state=...` (which callbackUrl() above does, and which
// Enable Banking's application has NOT registered with those extra query
// parameters) made every request fail before consent could ever start.
// This helper derives the callback URI from trusted SERVER configuration
// (`appOrigin`, i.e. `env.APP_ORIGIN`) rather than from the browser-supplied
// `redirectUri` at all -- the two happen to share an origin today (server.js
// already enforces that equality for the application-return destination),
// but deriving this one independently is what makes it genuinely
// server-owned rather than incidentally correct. The `state` (and
// therefore which provider/consent this belongs to) still reaches the
// callback route -- Enable Banking echoes the exact `state` value we send
// as a separate top-level field in the POST /auth body back as a `?state=`
// query parameter on its own redirect (standard OAuth2-style behavior,
// confirmed against the current official API reference), and the callback
// route now derives `provider` from that verified state's own payload
// (see server.js's callback route and security.js's verifyState()) rather
// than from any query parameter this function would otherwise have to bake
// in. GoCardless and PayPal are deliberately NOT changed to use this --
// unlike Enable Banking, neither has been proven to reject (or shown to
// need) the query-stringed form, and GoCardless in particular is known to
// redirect back to its configured URI verbatim with no echo of its own, so
// embedding state directly in the URL is how its round trip actually works
// today. See FinancePlanner/Security/Provider Callback Binding.md.
function canonicalCallbackUrl(appOrigin) {
  return new URL('/api/connectors/callback', appOrigin)
}

// Widget descriptor support for Enable Banking's official Auth Flow widget
// (<enablebanking-auth-flow>, https://enablebanking.com/docs/api/widgets/#auth-flow),
// added 2026-08-22 so the pre-ASPSP-authorization step can render inside
// Finance Planner's own modal instead of an abrupt full-page redirect --
// Enable Banking explicitly does not support running the flow in a
// cross-origin iframe, so the official custom element is the only supported
// embedding mechanism. The widget needs two values straight from Enable
// Banking's own POST /auth response: `authorization_id` and the ORIGIN of
// the `url` it returned (never the full URL -- path/query are not part of
// the widget's documented `origin` attribute and must never reach the DOM).
//
// Unlike ENABLE_BANKING_LOGO_HOSTNAMES above (a single fixed CDN hostname
// confirmed against the API reference), the authorization URL can
// legitimately live on more than one Enable Banking-owned host: production
// widget traffic uses `auth.enablebanking.com`, but a given sandbox/live run
// may return a different Enable Banking-owned host (confirmed live
// 2026-08-21/22: the real sandbox response pointed at
// `tilisy-sandbox.enablebanking.com`). This uses an explicit suffix-based
// ownership policy -- exactly `enablebanking.com` or any `*.enablebanking.com`
// subdomain -- rather than either a single fixed hostname (too narrow, breaks
// on the very sandbox host this was built against) or "any HTTPS host the
// provider claims" (too broad, defeats the point of an allowlist).
const ENABLE_BANKING_WIDGET_HOSTNAME_SUFFIX = '.enablebanking.com'
const ENABLE_BANKING_WIDGET_HOSTNAME_EXACT = 'enablebanking.com'
function isEnableBankingOwnedHost(hostname) {
  return hostname === ENABLE_BANKING_WIDGET_HOSTNAME_EXACT || hostname.endsWith(ENABLE_BANKING_WIDGET_HOSTNAME_SUFFIX)
}

// Returns just the bare origin (scheme + host [+ port]), or null for
// anything that doesn't pass -- callers must treat null as "no widget
// metadata available" and fall back to the plain redirect, never throw and
// never forward a partially-validated value. Deliberately mirrors
// validateEnableBankingLogoUrl()'s fail-closed shape (HTTPS-only, reject
// embedded userinfo) plus the wider hostname policy above.
function validateEnableBankingAuthOrigin(candidateUrl) {
  if (!candidateUrl || typeof candidateUrl !== 'string') return null
  let parsed
  try { parsed = new URL(candidateUrl) } catch { return null }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username || parsed.password) return null
  if (!isEnableBankingOwnedHost(parsed.hostname)) return null
  return parsed.origin
}

// Bounded, safe-charset check for the opaque authorization_id Enable Banking
// returns -- it is embedded directly into a DOM attribute by the frontend
// widget wrapper, so this is the server-side gate against ever forwarding an
// unbounded or unexpectedly-shaped upstream value, not just a UUID-format
// nicety. Real Enable Banking authorization ids are UUIDs; this pattern is
// intentionally a little more permissive than a strict UUID regex so a
// provider-side format change doesn't immediately fail closed, while still
// rejecting anything absurd (empty, huge, containing markup-relevant
// characters).
const AUTHORIZATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/
function validEnableBankingAuthorizationId(candidate) {
  return typeof candidate === 'string' && AUTHORIZATION_ID_PATTERN.test(candidate) ? candidate : null
}

// Sandbox is a property of which Enable Banking APPLICATION issued the
// authorization (sandbox vs. production application credentials), which
// Finance Planner has no direct API signal for -- so this prefers an
// explicit operator setting and only falls back to inference, and only ever
// infers `true` from a positive signal (a hostname that says so), never
// defaults a bare/unset config to sandbox. A future production deployment
// that simply never sets ENABLE_BANKING_SANDBOX therefore stays `false`
// unless Enable Banking's own response host happens to say otherwise.
function isEnableBankingSandbox(env, authOriginHostname) {
  const configured = String(env.ENABLE_BANKING_SANDBOX || '').trim().toLowerCase()
  if (configured === 'true') return true
  if (configured === 'false') return false
  return authOriginHostname.includes('sandbox')
}

function sanitizeGocardlessInstitution(institution) {
  return {
    id: String(institution.id),
    name: String(institution.name || institution.id),
    ...(institution.bic ? { bic: String(institution.bic) } : {}),
    ...(institution.logo ? { logo: String(institution.logo) } : {}),
  }
}

class GoCardlessProvider extends OpenBankingProvider {
  constructor(env, core) {
    super({ id: 'gocardless', displayName: 'Bank (GoCardless)', kind: 'psd2-account-information', env, core })
    this.institutionsCache = new Map()
  }

  isConfigured() { return Boolean(this.env.GOCARDLESS_SECRET_ID && this.env.GOCARDLESS_SECRET_KEY) }

  // Shared by start() (to validate a requested institution) and the
  // institution-directory endpoint (to let the frontend search real banks
  // instead of guessing). Cached per country so a UI search doesn't hit
  // GoCardless on every keystroke.
  async listInstitutions(country, accessToken) {
    const cached = this.institutionsCache.get(country)
    const now = Date.now()
    if (cached && cached.expiresAt > now) return cached.institutions
    const token = accessToken || (await gocardlessToken(this.env)).access
    const policy = providerPolicy(this.env)
    const institutions = await jsonFetch(`${GC_BASE}/institutions/?country=${encodeURIComponent(country)}`, { headers: { Authorization: `Bearer ${token}` } }, policy)
    if (!Array.isArray(institutions)) throw new Error('GoCardless institution response is invalid.')
    this.institutionsCache.set(country, { institutions, expiresAt: now + INSTITUTIONS_CACHE_TTL_MS })
    return institutions
  }

  async institutionDirectory(country = 'DE') {
    if (!this.isConfigured()) throw new HttpError(503, 'provider_not_configured', `${this.displayName} is not configured.`)
    const institutions = await this.listInstitutions(country)
    return institutions.map(sanitizeGocardlessInstitution)
  }

  async start({ state, redirectUri, country = 'DE', institutionId }) {
    if (!this.isConfigured()) throw new Error('GoCardless credentials are not configured.')
    await this.core.validateReadOnlyScope('balances,details,transactions')
    const token = await gocardlessToken(this.env)
    const institutions = await this.listInstitutions(country, token.access)

    // The institution the user actually selected always wins -- it is
    // validated against GoCardless's own directory, never trusted blindly
    // and never silently swapped for institutions[0]. The env override only
    // applies when no institution was supplied (e.g. an operator-triggered
    // sandbox/runtime-verification run), and it is validated the same way so
    // a stale override can't silently misroute a connection either.
    let resolvedInstitutionId
    let institutionSource
    if (institutionId) {
      const match = institutions.find((institution) => institution.id === institutionId)
      if (!match) throw new HttpError(400, 'invalid_institution', 'The selected institution is not currently available from GoCardless for this country.')
      resolvedInstitutionId = match.id
      institutionSource = 'user-selected'
    } else if (this.env.GOCARDLESS_INSTITUTION_ID) {
      const match = institutions.find((institution) => institution.id === this.env.GOCARDLESS_INSTITUTION_ID)
      if (!match) throw new HttpError(503, 'invalid_institution_override', 'GOCARDLESS_INSTITUTION_ID does not match a currently available GoCardless institution.')
      resolvedInstitutionId = match.id
      institutionSource = 'operator-override'
    } else {
      throw new HttpError(400, 'institution_required', 'Select a bank before continuing.')
    }

    const policy = providerPolicy(this.env)
    const agreement = await jsonFetch(`${GC_BASE}/agreements/enduser/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: resolvedInstitutionId, max_historical_days: 90, access_valid_for_days: GOCARDLESS_CONSENT_DAYS, access_scope: ['balances', 'details', 'transactions'] }),
    }, policy)
    if (!agreement?.id) throw new Error('GoCardless did not create an end-user agreement.')
    const requisition = await jsonFetch(`${GC_BASE}/requisitions/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect: callbackUrl(redirectUri, 'gocardless', state).toString(), institution_id: resolvedInstitutionId, agreement: agreement.id, reference: state, user_language: 'DE' }),
    }, policy)
    if (!requisition?.id || !requisition?.link) throw new Error('GoCardless did not create a valid requisition.')
    return {
      redirectUrl: requisition.link,
      credential: {
        requisitionId: requisition.id,
        agreementId: agreement.id,
        token,
        institutionId: resolvedInstitutionId,
        institutionSource,
        accessValidForDays: GOCARDLESS_CONSENT_DAYS,
      },
    }
  }

  async sync(credential) {
    const completedAt = new Date()
    const consentExpiresAt = gocardlessConsentExpiresAt(credential)
    if (consentExpiresAt && Date.parse(consentExpiresAt) <= completedAt.getTime() + CONSENT_EXPIRY_SAFETY_MS) {
      throw new Error(`GoCardless consent expired at ${consentExpiresAt}; reconnect the bank account.`)
    }

    let token = credential.token
    if (!tokenIsUsable(token, completedAt.getTime())) token = await gocardlessToken(this.env)
    const policy = providerPolicy(this.env)
    const requisition = await jsonFetch(`${GC_BASE}/requisitions/${credential.requisitionId}/`, { headers: { Authorization: `Bearer ${token.access}` } }, policy)
    const consentState = await this.core.validateProviderConsent('gocardless', requisition.status)
    if (consentState === 'expired') throw new Error(`GoCardless consent expired or was revoked: ${requisition.status}`)
    if (consentState !== 'ready') throw new Error(`GoCardless consent is not ready: ${requisition.status || 'unknown'}`)

    const window = syncWindow(credential.lastSyncedAt, completedAt, 90)
    const accounts = []
    const transactions = []
    const seen = new Set()
    for (const accountId of requisition.accounts ?? []) {
      const txUrl = new URL(`${GC_BASE}/accounts/${accountId}/transactions/`)
      txUrl.searchParams.set('date_from', window.dateFrom)
      txUrl.searchParams.set('date_to', window.dateTo)
      const [details, balances, tx] = await Promise.all([
        jsonFetch(`${GC_BASE}/accounts/${accountId}/details/`, { headers: { Authorization: `Bearer ${token.access}` } }, policy),
        jsonFetch(`${GC_BASE}/accounts/${accountId}/balances/`, { headers: { Authorization: `Bearer ${token.access}` } }, policy),
        jsonFetch(txUrl, { headers: { Authorization: `Bearer ${token.access}` } }, policy),
      ])
      const account = details.account ?? {}
      const balance = balances.balances?.find((item) => item.balanceAmount?.currency === 'EUR')?.balanceAmount?.amount ?? '0'
      const type = await normalizeProviderAccountType(account, this.env, this.core)
      const balanceCents = await this.core.normalizeProviderAmount(balance)
      // GoCardless has no separate cross-session matching hash like Enable
      // Banking's identification_hash, but its account details response
      // already documents an `iban` field (the same field this line already
      // used as a display-name fallback) -- stable for the same real
      // account across a new requisition/agreement. Absent for an account
      // with no IBAN (e.g. some card products): stableAccountId() returns
      // undefined in that case, which is the correct fail-conservative
      // outcome, not an error.
      const accountStableId = stableAccountId(this.env, 'gocardless', account.iban)
      accounts.push({ externalId: accountId, name: account.name || account.product || account.iban || 'Bankkonto', type, balanceCents, currency: 'EUR', stableId: accountStableId })
      for (const [pending, rows] of [[false, tx.transactions?.booked ?? []], [true, tx.transactions?.pending ?? []]]) {
        if (!Array.isArray(rows)) throw new Error('GoCardless transaction response is invalid.')
        for (const item of rows) {
          if (item.transactionAmount?.currency !== 'EUR') continue
          const signedCents = await this.core.normalizeProviderAmount(item.transactionAmount.amount)
          await normalizeSignedAmount(signedCents, this.env)
          const externalId = item.transactionId || `${accountId}:${item.bookingDate || item.valueDate}:${item.transactionAmount.amount}:${item.remittanceInformationUnstructured || ''}`
          if (seen.has(externalId)) continue
          seen.add(externalId)
          // stableTransactionId (2026-08-27, PR #154 reconnect-dedup follow-
          // up): GoCardless documents transactionId as "Transaction
          // identifier provided by the financial institution" -- bank-
          // assigned, not requisition-scoped -- the same structural
          // property relied on for Enable Banking's equivalent above. Never
          // computed from the synthetic date/amount/description fallback
          // key. See stableTransactionId()'s doc comment in this file for
          // the full rationale and its conservative-fallback contract.
          const txStableId = stableTransactionId(this.env, 'gocardless', accountStableId, item.transactionId)
          transactions.push({ externalId, externalAccountId: accountId, stableTransactionId: txStableId, description: item.creditorName || item.debtorName || item.remittanceInformationUnstructured || item.additionalInformation || 'Banktransaktion', amountCents: signedCents, currency: 'EUR', bookingDate: item.bookingDate || item.valueDate || window.dateTo, pending })
        }
      }
    }
    const reconciliation = { accountCount: accounts.length, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString() }
    await validateProviderReconciliationWithCore(this.core, { accounts, transactions, reconciliation })
    const health = completedHealth({ completedAt, consentExpiresAt, accounts, transactions })
    return {
      accounts,
      transactions,
      credential: { ...credential, token, lastSyncedAt: completedAt.toISOString(), consentExpiresAt, health },
      reconciliation: { ...reconciliation, health },
      consentExpiresAt,
      health,
    }
  }

  // Asks GoCardless to end the requisition (and its access) so a
  // Finance Planner disconnect also withdraws the provider-side consent,
  // not just the local row. Never throws: a failed/unreachable revoke must
  // not block the user's local disconnect, but it must also never be
  // reported as confirmed when it wasn't.
  async disconnect(credential) {
    const requisitionId = credential?.requisitionId
    if (!requisitionId) return { revoked: false, reason: 'not_applicable' }
    try {
      let token = credential.token
      if (!tokenIsUsable(token)) token = await gocardlessToken(this.env)
      await jsonFetch(`${GC_BASE}/requisitions/${requisitionId}/`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.access}` } }, providerPolicy(this.env))
      return { revoked: true }
    } catch (error) {
      if (error?.status === 404) return { revoked: true }
      return { revoked: false, reason: 'provider_error' }
    }
  }
}

function enableBankingHeaders(env) {
  return { Authorization: `Bearer ${signEnableBankingJwt(env)}`, 'Content-Type': 'application/json' }
}

// Enable Banking identifies an ASPSP by the compound {name,country} pair, not
// a single opaque id -- unlike GoCardless/PayPal, whose institution/provider
// ids are already single strings. This mints Finance Planner's own opaque id
// for the picker/institutionId contract, splitting on the FIRST colon only
// (a bank name could in principle contain one; a country code never does).
function encodeAspspId(name, country) {
  return `${country}:${name}`
}
function decodeAspspId(id) {
  const separator = String(id).indexOf(':')
  if (separator < 0) return null
  return { country: id.slice(0, separator), name: id.slice(separator + 1) }
}

// Enable Banking's ASPSP object carries a `group` field for cooperative
// banking networks (ASPSPGroup: { name, logo }) -- e.g. every Volksbank/
// Raiffeisenbank branch and every Sparkasse shares one group.name. Passed
// through sanitized to exactly {name, logo?} like every other field here, so
// the frontend can group/filter the directory by real provider metadata
// instead of guessing from the bank's own name. Never more than that: no
// group id, no member list, nothing else upstream might add to this object.
function sanitizeEnableBankingGroup(group) {
  if (!group || typeof group !== 'object' || !group.name) return undefined
  return { name: String(group.name), ...(group.logo ? { logo: String(group.logo) } : {}) }
}

// Confirmed against the current official API reference (2026-08-21): every
// documented ASPSP.logo/group.logo example is hosted on enablebanking.com
// itself (e.g. "https://enablebanking.com/brands/FI/Nordea/"), a
// Uploadcare-backed CDN under their own domain. Strict allowlist of exactly
// that hostname -- not a general "any HTTPS URL the provider claims" policy.
// If Enable Banking ever serves logos from a different domain, this must be
// updated deliberately, not silently widened.
const ENABLE_BANKING_LOGO_HOSTNAMES = new Set(['enablebanking.com'])

// Re-validates a logo URL the live /aspsps response itself returned --
// HTTPS only, exact hostname allowlist. Returns null (never throws) for
// anything that doesn't pass, so a malformed or off-allowlist value from
// upstream just falls through to the next fallback in the chain rather than
// failing the whole request.
function validateEnableBankingLogoUrl(candidate) {
  if (!candidate || typeof candidate !== 'string') return null
  let parsed
  try { parsed = new URL(candidate) } catch { return null }
  if (parsed.protocol !== 'https:' || !ENABLE_BANKING_LOGO_HOSTNAMES.has(parsed.hostname)) return null
  // Reject embedded userinfo (https://user:pass@host/...) outright rather
  // than stripping it -- a legitimate CDN logo URL never has a reason to
  // carry one, and some HTTP clients have historically mishandled userinfo
  // in ways that leak it as request headers.
  if (parsed.username || parsed.password) return null
  return parsed.toString()
}

function sanitizeEnableBankingAspsp(aspsp) {
  const group = sanitizeEnableBankingGroup(aspsp.group)
  return {
    id: encodeAspspId(aspsp.name, aspsp.country),
    name: String(aspsp.name || ''),
    country: String(aspsp.country || ''),
    ...(aspsp.bic ? { bic: String(aspsp.bic) } : {}),
    ...(aspsp.logo ? { logo: String(aspsp.logo) } : {}),
    ...(group ? { group } : {}),
  }
}

// Best-effort EUR balance selection when a session exposes more than one
// balance type for the same account -- CLBD (closing booked) is the most
// standard "the balance a user expects to see" reading; CLAV (closing
// available) is the next best; anything else EUR is a last resort. Mirrors
// GoCardlessProvider.sync()'s equally permissive '0' fallback when no EUR
// balance is present at all, rather than treating that as an error.
function selectEnableBankingBalance(balances) {
  const eur = (balances || []).filter((item) => item.balance_amount?.currency === 'EUR')
  const preferred = eur.find((item) => item.balance_type === 'CLBD') || eur.find((item) => item.balance_type === 'CLAV') || eur[0]
  return preferred?.balance_amount?.amount ?? '0'
}

// GET /sessions/{id}'s documented shape (confirmed 2026-08-25 against the
// current official Enable Banking account-information API reference)
// carries `accounts` as an array of bare account-id STRINGS -- unlike
// POST /sessions, whose `accounts` array holds full AccountResource
// objects. A real Enable Banking Mock ASPSP run found sync() treating the
// GET /sessions response the same way as the POST one, so `account.uid` on
// a bare string was always undefined -- producing requests like
// /accounts/undefined/balances, which the provider correctly rejected with
// HTTP 422. Enable Banking's real account ids are UUIDs; this allowlist is
// intentionally narrower than "any non-empty string" so a malformed or
// provider-corrupted value fails closed here rather than reaching a URL
// path segment at all.
const ENABLE_BANKING_ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
function isValidEnableBankingAccountId(value) {
  return typeof value === 'string' && ENABLE_BANKING_ACCOUNT_ID_PATTERN.test(value)
}

// Enable Banking's documented transaction-status enum (current official
// account-information API reference), used to fail closed on anything
// outside it rather than guessing -- see the status handling in sync()
// below. Only BOOK/PDNG map to an ExternalTransaction; the rest
// (cancelled/held/other/rejected/scheduled) have no correct booked-or-
// pending mapping in Finance Planner's model and are skipped, never
// imported as booked.
const ENABLE_BANKING_KNOWN_TRANSACTION_STATUSES = new Set(['BOOK', 'PDNG', 'CNCL', 'HOLD', 'OTHR', 'RJCT', 'SCHD'])

class EnableBankingProvider extends OpenBankingProvider {
  constructor(env, core) {
    super({ id: 'enablebanking', displayName: 'Bank connection', kind: 'psd2-account-information', env, core })
    this.institutionsCache = new Map()
    // Keyed by the validated logo URL itself (not institutionId), bounded to
    // LOGO_CACHE_MAX_ENTRIES -- an ASPSP's own logo and its cooperative
    // group's logo are both real, shared URLs across many institutions
    // (every Volksbank/Raiffeisenbank branch shares one group logo), so
    // caching by URL naturally dedupes that sharing too.
    this.logoCache = new Map()
  }

  isConfigured() { return isEnableBankingConfigured(this.env) }

  // Shared by start() (to validate a requested ASPSP) and the institution-
  // directory endpoint. Cached per country, same bounded-Map/TTL pattern as
  // GoCardlessProvider.listInstitutions -- a UI search doesn't hit Enable
  // Banking on every keystroke.
  async listAspsps(country) {
    const cached = this.institutionsCache.get(country)
    const now = Date.now()
    if (cached && cached.expiresAt > now) return cached.aspsps
    const policy = providerPolicy(this.env)
    const response = await jsonFetch(`${EB_BASE}/aspsps?country=${encodeURIComponent(country)}`, { headers: enableBankingHeaders(this.env) }, policy)
    if (!Array.isArray(response?.aspsps)) throw new Error('Enable Banking ASPSP response is invalid.')
    this.institutionsCache.set(country, { aspsps: response.aspsps, expiresAt: now + INSTITUTIONS_CACHE_TTL_MS })
    return response.aspsps
  }

  async institutionDirectory(country = 'DE') {
    if (!this.isConfigured()) throw new HttpError(503, 'provider_not_configured', `${this.displayName} is not configured.`)
    const aspsps = await this.listAspsps(country)
    return aspsps.map(sanitizeEnableBankingAspsp)
  }

  // Shared by start() and institutionLogoUrl(): decodes the institutionId,
  // validates its 2-letter country, and finds the matching ASPSP in the
  // live directory. Never guesses, never a [0] fallback -- returns null
  // only for a malformed/unmatched institutionId. A listAspsps() failure
  // (e.g. Enable Banking's /aspsps being down) deliberately propagates as a
  // real exception here rather than being folded into null, so it can
  // never be silently reinterpreted downstream as "no such institution"
  // when the real problem is an upstream outage -- start() lets it
  // propagate uncaught exactly as it always has; institutionLogoUrl() below
  // is the one caller that catches it, matching its own "never throws"
  // contract.
  async resolveAspsp(institutionId) {
    const decoded = decodeAspspId(institutionId)
    if (!decoded || !/^[A-Z]{2}$/.test(decoded.country)) return null
    const aspsps = await this.listAspsps(decoded.country)
    return aspsps.find((aspsp) => aspsp.name === decoded.name && aspsp.country === decoded.country) || null
  }

  // Re-derives the institution from the live directory (same anti-guessing
  // contract as start()) rather than trusting any URL the client might send
  // -- the browser never gets to name a logo URL directly, only an
  // institutionId. Prefers the bank's own exact logo; falls back to its
  // cooperative-network group logo (e.g. every Volksbank/Raiffeisenbank
  // shares one) when the bank itself doesn't have one. Returns null (never
  // throws) for anything unresolvable -- the frontend's lettermark is
  // always a safe fallback.
  async institutionLogoUrl(institutionId) {
    if (!this.isConfigured()) return null
    let match
    try { match = await this.resolveAspsp(institutionId) } catch { return null }
    if (!match) return null
    return validateEnableBankingLogoUrl(match.logo) || validateEnableBankingLogoUrl(match.group?.logo) || null
  }

  // Bounded, TTL'd, in-memory cache in front of fetchBoundedImage() so the
  // same shared logo (very common for group logos, and for any bank several
  // concurrent users are looking at) isn't re-fetched from Enable Banking's
  // CDN on every request. Keyed by the already-validated logo URL.
  async fetchLogo(validatedUrl) {
    const cached = this.logoCache.get(validatedUrl)
    const now = Date.now()
    if (cached && cached.expiresAt > now) return cached.image
    const image = await fetchBoundedImage(validatedUrl, { allowedHostnames: ENABLE_BANKING_LOGO_HOSTNAMES })
    if (!image) return null
    if (this.logoCache.size >= LOGO_CACHE_MAX_ENTRIES) this.logoCache.delete(this.logoCache.keys().next().value)
    this.logoCache.set(validatedUrl, { image, expiresAt: now + LOGO_CACHE_TTL_MS })
    return image
  }

  // What server.js's logo route actually calls: resolve the validated URL,
  // then fetch it (cached, bounded). Split into institutionLogoUrl() +
  // fetchLogo() above so each half is independently unit-testable (URL
  // resolution/validation vs. the bounded-fetch mechanics).
  async fetchInstitutionLogo(institutionId) {
    const url = await this.institutionLogoUrl(institutionId)
    if (!url) return null
    return this.fetchLogo(url)
  }

  // `redirectUri` (the browser's application-return destination) is kept in
  // the destructured signature for interface consistency with every other
  // adapter's start() -- server.js calls all of them uniformly -- but is
  // deliberately unused in the body below. Enable Banking's own
  // redirect_url is derived independently from server config; see
  // canonicalCallbackUrl()'s doc comment.
  async start({ state, redirectUri: _redirectUri, country = 'DE', institutionId }) {
    if (!this.isConfigured()) throw new Error('Enable Banking credentials are not configured.')
    await this.core.validateReadOnlyScope('accounts,balances,transactions')
    if (!institutionId) throw new HttpError(400, 'institution_required', 'Select a bank before continuing.')
    // resolveAspsp() validates the country the same way the sibling
    // /institutions listing route already does (server.js) -- it comes
    // straight from the client-supplied institutionId, and listAspsps()
    // caches by country string, so an unvalidated value would let an
    // attacker grow institutionsCache with unbounded distinct keys. Never
    // guessed, never a [0] fallback -- the exact same anti-guessing
    // contract as GoCardlessProvider.start(): the picker's selection must
    // match a real, currently-offered ASPSP. A listAspsps() failure (e.g.
    // Enable Banking being down) propagates uncaught here, not folded into
    // invalid_institution.
    const match = await this.resolveAspsp(institutionId)
    if (!match) throw new HttpError(400, 'invalid_institution', 'The selected institution is not currently available from Enable Banking.')

    const configuredDays = Number(this.env.ENABLE_BANKING_CONSENT_DAYS || ENABLEBANKING_DEFAULT_CONSENT_DAYS)
    const requestedDays = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : ENABLEBANKING_DEFAULT_CONSENT_DAYS
    const requestedMs = requestedDays * 86_400_000
    // Fixed 2026-08-21 (found investigating a live "Internal server error" on
    // POST /auth for a real ASPSP): `maximum_consent_validity` is documented
    // in the current official ASPSPData schema as "Maximum consent validity
    // which bank supports **in seconds**", but this was being compared
    // directly against `requestedDays` (a day count) with no unit
    // conversion. A seconds value is numerically far larger than any
    // realistic day count, so `Math.min(requestedDays, maxDays)` never
    // actually clamped anything -- every request silently asked for the
    // full `ENABLE_BANKING_CONSENT_DAYS` (default 90-day) window regardless
    // of what the selected bank's sandbox/production ASPSP actually
    // supports. Enable Banking rejects `access.valid_until` once it exceeds
    // `now + maximum_consent_validity` (their documented constraint on the
    // Access schema) -- for any bank whose real cap is under the default,
    // this surfaced as a bare provider 4xx that server.js's generic error
    // classifier turns into an undiagnosable "Internal server error" (see
    // jsonFetch() above for the accompanying provider-error-detail fix).
    // Kept in milliseconds throughout instead of rounding to whole days so
    // a clamp lands exactly on the ASPSP's own limit, never a day over it.
    const maxValiditySeconds = Number(match.maximum_consent_validity)
    const maxValidityMs = Number.isFinite(maxValiditySeconds) && maxValiditySeconds > 0 ? maxValiditySeconds * 1000 : null
    const consentMs = maxValidityMs !== null ? Math.min(requestedMs, maxValidityMs) : requestedMs
    const validUntil = new Date(Date.now() + consentMs).toISOString()

    const policy = providerPolicy(this.env)
    const response = await jsonFetch(`${EB_BASE}/auth`, {
      method: 'POST',
      headers: enableBankingHeaders(this.env),
      // access.balances/transactions requested explicitly (2026-08-21) so
      // the actual consent scope matches what the Connections UI already
      // tells the user they're granting (account information, balances,
      // transactions) -- previously only the implicit accounts-list access
      // was requested. Still deliberately no `payments` field, which is
      // what actually enforces AIS-only (never directory filtering, which
      // the current docs don't confirm the shape of).
      body: JSON.stringify({
        access: { valid_until: validUntil, balances: true, transactions: true },
        aspsp: { name: match.name, country: match.country },
        state,
        // The canonical, server-derived provider callback URI -- see
        // canonicalCallbackUrl()'s doc comment for the full redirect_uri
        // architecture and why this must be the bare, exact URL Enable
        // Banking's Control Panel has registered, never the browser-
        // supplied application-return destination with query parameters
        // appended on top (the literal cause of a live
        // REDIRECT_URI_NOT_ALLOWED rejection, fixed 2026-08-21).
        redirect_url: canonicalCallbackUrl(this.env.APP_ORIGIN || 'http://localhost:5173').toString(),
        psu_type: 'personal',
      }),
    }, policy)
    if (!response?.url || !String(response.url).startsWith('https://')) throw new Error('Enable Banking did not return a secure authorization URL.')

    // Safe, minimal descriptor for the frontend's official Auth Flow widget
    // (see the validators above) -- built ONLY from this trusted provider
    // response, never from anything client-supplied. `authFlow` is null
    // (never a partially-filled object) whenever either value fails
    // validation, so the frontend's fallback-to-plain-redirect path is the
    // only option in that case rather than being handed a broken widget
    // descriptor. Deliberately excludes signed `state`, any JWT/PEM/API
    // credential, and the `credential` object below -- those never leave
    // the server.
    const authOrigin = validateEnableBankingAuthOrigin(response.url)
    const authorizationId = validEnableBankingAuthorizationId(response.authorization_id)
    const authFlow = authOrigin && authorizationId
      ? {
          provider: 'enablebanking',
          authorizationId,
          origin: authOrigin,
          sandbox: isEnableBankingSandbox(this.env, new URL(authOrigin).hostname),
        }
      : null

    return {
      redirectUrl: response.url,
      authFlow,
      credential: {
        // Round-trips through server.js's connection() helper as
        // stored.institutionId, exactly like GoCardlessProvider's
        // resolvedInstitutionId -- without this, Reconnect (which resubmits
        // the stored institutionId) has nothing to resubmit and start()
        // rejects it with institution_required, making Reconnect
        // unconditionally broken for every Enable Banking connection.
        institutionId: encodeAspspId(match.name, match.country),
        aspspName: match.name,
        aspspCountry: match.country,
        authorizationId: response.authorization_id,
        accessValidUntil: validUntil,
      },
    }
  }

  // Exchanges the authorization code the callback URL carried for a real
  // session, server-side only -- the code itself is never stored or
  // returned. Called by server.js's callback route only after its own
  // state/nonce verification has already succeeded.
  async completeCallback({ code, pending }) {
    if (!code) throw new HttpError(400, 'authorization_denied', 'Enable Banking did not return an authorization code -- the user likely declined at the bank.')
    const policy = providerPolicy(this.env)
    const response = await jsonFetch(`${EB_BASE}/sessions`, {
      method: 'POST',
      headers: enableBankingHeaders(this.env),
      body: JSON.stringify({ code }),
    }, policy)
    if (!response?.session_id || !Array.isArray(response.accounts)) throw new Error('Enable Banking did not return a valid session.')
    // Same bounded safe-charset validation sync() applies to every live
    // account id it reads from GET /sessions/{id} -- applied here too so
    // the guarantee is genuinely end-to-end: nothing this codebase ever
    // persists as an account uid can be malformed, regardless of which
    // Enable Banking response it originally came from (found by review,
    // 2026-08-25, while confirming sync()'s own fix closes this fully).
    for (const account of response.accounts) {
      if (!isValidEnableBankingAccountId(account?.uid)) throw new Error(`Enable Banking session returned a malformed account id: ${JSON.stringify(account?.uid ?? null)}`)
    }
    return {
      ...pending,
      sessionId: response.session_id,
      // identificationHash: Enable Banking's documented identification_hash
      // (POST /sessions already returns full AccountResource objects,
      // confirmed against the current official API reference) -- "based on
      // the account number... can be used for matching accounts between
      // multiple sessions." Captured raw here (validated/HMAC'd later, only
      // at the point stableAccountId() actually derives ExternalAccount.
      // stableId in sync()) so a stored credential always has it available
      // for a future sync, exactly like uid/name/currency/cashAccountType
      // already are.
      accounts: response.accounts.map((account) => ({
        uid: account.uid,
        name: account.name,
        currency: account.currency,
        cashAccountType: account.cash_account_type,
        identificationHash: typeof account.identification_hash === 'string' ? account.identification_hash : undefined,
      })),
      accessValidUntil: response.access?.valid_until || pending.accessValidUntil,
      authorizedAt: new Date().toISOString(),
    }
  }

  async sync(credential) {
    const completedAt = new Date()
    const consentExpiresAt = credential.accessValidUntil || null
    if (consentExpiresAt && Date.parse(consentExpiresAt) <= completedAt.getTime() + CONSENT_EXPIRY_SAFETY_MS) {
      throw new Error(`Enable Banking consent expired at ${consentExpiresAt}; reconnect the bank account.`)
    }
    const policy = providerPolicy(this.env)
    const session = await jsonFetch(`${EB_BASE}/sessions/${credential.sessionId}`, { headers: enableBankingHeaders(this.env) }, policy)
    const consentState = await this.core.validateProviderConsent('enablebanking', session?.status)
    if (consentState === 'expired') throw new Error(`Enable Banking consent expired or was revoked: ${session?.status}`)
    if (consentState !== 'ready') throw new Error(`Enable Banking consent is not ready: ${session?.status || 'unknown'}`)

    // Refreshed from this same session response (no extra network call --
    // we already fetched it above for the status check) rather than the
    // account list/expiry frozen once at completeCallback() time. Without
    // this, an account added or removed at the bank after initial connection
    // would never be reflected, and a consent window the provider
    // extended/shortened would silently drift from the locally cached value.
    //
    // Fixed 2026-08-25 (live Mock ASPSP run, provider 422 on the first
    // sync): GET /sessions/{id}.accounts is documented as an array of bare
    // account-id STRINGS, not AccountResource objects (POST /sessions
    // returns those) -- treating a string as {uid,...} always produced
    // uid: undefined here, which then built /accounts/undefined/... URLs.
    //
    // `Array.isArray` alone (not `.length > 0`) gates the fallback to
    // stored credential.accounts: a deployment that omits `accounts`
    // entirely from GET /sessions/{id} still falls back to what
    // completeCallback() originally stored (unchanged prior behavior), but
    // an explicit empty array is real information -- every account was
    // removed/revoked at the bank -- and must not resurrect stale stored
    // accounts as if they were still active.
    //
    // For each live account id: reuse the originally-stored AccountResource
    // metadata (name/currency/cashAccountType) when that id is still
    // present, since GET /sessions/{id} itself carries no such metadata
    // fields. An id the live session now exposes that ISN'T in stored
    // metadata (a genuinely new account) gets its real metadata via the
    // official GET /accounts/{id}/details endpoint instead of ever being
    // invented. Any account-id string that doesn't look like a real Enable
    // Banking account id fails the whole sync closed rather than being
    // silently skipped or guessed into shape.
    let liveAccounts
    if (!Array.isArray(session?.accounts)) {
      // Re-validated even on this fallback path -- credential.accounts was
      // already validated once, at completeCallback() time, but re-checking
      // here means the "no malformed id ever reaches a balances/transactions
      // URL" guarantee holds regardless of how this credential got onto
      // disk (e.g. a hand-edited fixture in a dev environment, or a future
      // storage-layer bug), not only for data that arrived through this
      // exact code path.
      for (const account of credential.accounts || []) {
        if (!isValidEnableBankingAccountId(account?.uid)) throw new Error(`Stored Enable Banking credential has a malformed account id: ${JSON.stringify(account?.uid ?? null)}`)
      }
      liveAccounts = credential.accounts
    } else {
      const storedByUid = new Map((credential.accounts || []).map((account) => [account.uid, account]))
      liveAccounts = []
      for (const accountId of session.accounts) {
        if (!isValidEnableBankingAccountId(accountId)) {
          throw new Error(`Enable Banking session returned a malformed account id: ${JSON.stringify(accountId)}`)
        }
        const stored = storedByUid.get(accountId)
        if (stored) { liveAccounts.push(stored); continue }
        const details = await jsonFetch(`${EB_BASE}/accounts/${encodeURIComponent(accountId)}/details`, { headers: enableBankingHeaders(this.env) }, policy)
        if (!details?.uid || details.uid !== accountId) {
          throw new Error(`Enable Banking account details response is invalid for account ${accountId}.`)
        }
        liveAccounts.push({ uid: details.uid, name: details.name, currency: details.currency, cashAccountType: details.cash_account_type, identificationHash: typeof details.identification_hash === 'string' ? details.identification_hash : undefined })
      }
    }
    const liveConsentExpiresAt = session?.access?.valid_until || consentExpiresAt
    // The FIRST sync for this connection (no prior successful lastSyncedAt)
    // uses Enable Banking's documented `strategy=longest` for its initial
    // transaction fetch -- their own docs recommend it specifically to
    // avoid a WRONG_TRANSACTIONS_PERIOD rejection and to retrieve the
    // longest history the ASPSP will return, rather than the short
    // incremental window meant for routine re-syncs.
    const isFirstSync = !credential.lastSyncedAt

    const window = syncWindow(credential.lastSyncedAt, completedAt, 90)
    const accounts = []
    const transactions = []
    const seen = new Set()
    for (const account of liveAccounts ?? []) {
      const balances = await jsonFetch(`${EB_BASE}/accounts/${account.uid}/balances`, { headers: enableBankingHeaders(this.env) }, policy)
      if (!Array.isArray(balances?.balances)) throw new Error('Enable Banking balance response is invalid.')
      const balance = selectEnableBankingBalance(balances.balances)
      const type = await normalizeProviderAccountType({ cashAccountType: account.cashAccountType }, this.env, this.core)
      const balanceCents = await this.core.normalizeProviderAmount(balance)
      // Computed once per account, reused below for both the account's own
      // stableId and every one of its transactions' stableTransactionId --
      // see the doc comment on stableTransactionId's derivation further
      // down for why this must be the account-level stable identity, never
      // the session-scoped account.uid.
      const accountStableId = stableAccountId(this.env, 'enablebanking', account.identificationHash)
      accounts.push({ externalId: account.uid, name: account.name || 'Bankkonto', type, balanceCents, currency: 'EUR', stableId: accountStableId })

      // continuation_key pagination: strategy/date parameters stay
      // identical across every page (Enable Banking's documented
      // requirement); bounded to MAX_ENABLEBANKING_PAGES so a
      // provider-controlled continuation_key can never drive an unbounded
      // loop. An empty page with a continuation_key still present must
      // still continue -- only the key's absence ends the loop.
      let continuationKey
      let pageCount = 0
      do {
        const txUrl = new URL(`${EB_BASE}/accounts/${account.uid}/transactions`)
        if (isFirstSync) {
          // strategy=longest: Enable Banking's documented recommendation
          // for the very first transaction fetch after authorization --
          // avoids a WRONG_TRANSACTIONS_PERIOD rejection and asks for the
          // longest history the ASPSP will return. date_from is sent only
          // as a lower-bound suggestion; longest mode is documented as not
          // depending on date_to, so it is deliberately omitted here.
          txUrl.searchParams.set('strategy', 'longest')
          txUrl.searchParams.set('date_from', window.dateFrom)
        } else {
          // Subsequent syncs: normal/default strategy over the existing
          // incremental date_from/date_to window.
          txUrl.searchParams.set('date_from', window.dateFrom)
          txUrl.searchParams.set('date_to', window.dateTo)
        }
        if (continuationKey) txUrl.searchParams.set('continuation_key', continuationKey)
        const page = await jsonFetch(txUrl, { headers: enableBankingHeaders(this.env) }, policy)
        if (!Array.isArray(page?.transactions)) throw new Error('Enable Banking transaction response is invalid.')
        for (const item of page.transactions) {
          if (item.transaction_amount?.currency !== 'EUR') continue
          // Found by PR #154 review (2026-08-25): the current official
          // Enable Banking transaction-status enum has seven values --
          // BOOK, PDNG, CNCL, HOLD, OTHR, RJCT, SCHD -- but this loop only
          // ever checked for PDNG, so CNCL/HOLD/OTHR/RJCT/SCHD all silently
          // became pending: false and were imported as ordinary booked
          // transactions. Finance Planner's transaction model has no
          // cancelled/held/scheduled/other category (`ExternalTransaction`
          // only has a boolean `pending`), so there is no correct mapping
          // for those five statuses other than not importing them as either
          // booked or pending -- skipped here, the same way a non-EUR
          // transaction is skipped above, rather than guessing. Only BOOK
          // and PDNG ever reach the push below. Fails closed (throws) for
          // any status outside this documented set, exactly like the
          // credit_debit_indicator check below -- never silently defaults
          // an unrecognized value to booked.
          const status = item.status
          if (!ENABLE_BANKING_KNOWN_TRANSACTION_STATUSES.has(status)) {
            throw new Error(`Enable Banking transaction has an unrecognized status: ${JSON.stringify(status ?? null)}`)
          }
          if (status !== 'BOOK' && status !== 'PDNG') continue
          // Found during Mock ASPSP sandbox prep (2026-08-22), confirmed
          // against the current official Enable Banking account-information
          // API reference: transaction_amount.amount is an ABSOLUTE value --
          // unlike GoCardless's transactionAmount.amount, which already
          // carries its own sign -- and direction comes only from
          // credit_debit_indicator (CRDT = credit/incoming, DBIT =
          // debit/outgoing). The previous code passed the absolute amount
          // straight through, silently importing every transaction as
          // positive income. Applying the sign as a decimal-string prefix
          // BEFORE handing it to the same core.normalizeProviderAmount() /
          // COBOL fixed-point path every other provider already uses --
          // never a JS-side sign flip on the resulting integer -- keeps this
          // inside the existing deterministic architecture rather than
          // adding a second, parallel one; COBOL's NUMVAL-based parser
          // already accepts a leading '-' correctly. Fails closed (throws,
          // never silently treated as a credit) for anything other than the
          // two documented indicator values, rather than guessing a
          // direction from creditor/debtor fields.
          const indicator = item.credit_debit_indicator
          if (indicator !== 'CRDT' && indicator !== 'DBIT') {
            throw new Error(`Enable Banking transaction has an unrecognized credit_debit_indicator: ${JSON.stringify(indicator ?? null)}`)
          }
          const signedAmountText = indicator === 'DBIT' ? `-${item.transaction_amount.amount}` : String(item.transaction_amount.amount)
          const signedCents = await this.core.normalizeProviderAmount(signedAmountText)
          await normalizeSignedAmount(signedCents, this.env)
          // entry_reference is the ASPSP transaction identifier in the
          // current official API -- transaction_id is not part of the
          // documented transaction schema (also found during Mock ASPSP
          // prep). Namespaced with account.uid: Enable Banking documents
          // entry_reference as scoped to the account it was issued against,
          // never guaranteed unique across accounts, so two different
          // accounts sharing a value could otherwise silently dedupe each
          // other's transactions away via the shared `seen` set below. Falls
          // back to the existing deterministic account/date/amount/
          // description key (already account-namespaced) when absent.
          const externalId = item.entry_reference
            ? `${account.uid}:${item.entry_reference}`
            : `${account.uid}:${item.booking_date || item.value_date}:${item.transaction_amount.amount}:${(item.remittance_information || []).join(' ')}`
          if (seen.has(externalId)) continue
          seen.add(externalId)
          // stableTransactionId (found live 2026-08-27, PR #154, reconnect-
          // dedup follow-up): the pre-existing externalId above is
          // namespaced with account.uid, which is session-scoped and
          // changes on every reauthorization -- so it can never be used to
          // recognize "this is the same real transaction" across a
          // reconnect, only within one session. entry_reference itself is
          // NOT documented by Enable Banking as cross-session stable
          // (confirmed against the current official API reference: no such
          // guarantee is stated, unlike the account-level
          // identification_hash, which explicitly is). What IS true: it is
          // "the ASPSP transaction identifier" -- assigned by the bank
          // itself, not by the session -- which is the same structural
          // property that justified treating identification_hash as
          // account-stable. Deriving a value from entry_reference
          // NAMESPACED BY THE ACCOUNT'S OWN STABLE IDENTITY (never the
          // session-scoped account.uid) turns that bank-assigned reference
          // into something meaningfully more trustworthy across a reconnect
          // than before, without claiming a documentation guarantee that
          // does not exist. Only computed when BOTH the account has a
          // stableId AND a real entry_reference is present (never for the
          // synthetic date/amount/description fallback key) -- see
          // buildSyncPreview() in src/connectors.ts for how the absence of
          // this value is handled conservatively during a reconnect,
          // exactly like GoCardless's own equivalent below.
          const txStableId = stableTransactionId(this.env, 'enablebanking', accountStableId, item.entry_reference)
          transactions.push({
            externalId,
            externalAccountId: account.uid,
            stableTransactionId: txStableId,
            description: (item.remittance_information || []).join(' ') || 'Banktransaktion',
            amountCents: signedCents,
            currency: 'EUR',
            bookingDate: item.booking_date || item.value_date || item.transaction_date || window.dateTo,
            // Only BOOK/PDNG ever reach this push (see the status check
            // above), so this is now an exhaustive, not a best-effort, check.
            pending: status === 'PDNG',
          })
        }
        continuationKey = page.continuation_key
        pageCount += 1
        if (continuationKey && pageCount >= MAX_ENABLEBANKING_PAGES) throw new Error(`Enable Banking transaction pagination exceeds safety limit: ${pageCount}`)
      } while (continuationKey)
    }

    const reconciliation = { accountCount: accounts.length, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString() }
    await validateProviderReconciliationWithCore(this.core, { accounts, transactions, reconciliation })
    const health = completedHealth({ completedAt, consentExpiresAt: liveConsentExpiresAt, accounts, transactions })
    return {
      accounts,
      transactions,
      // Persists the refreshed account list and expiry, not the stale ones
      // this credential was loaded with, so the next sync() call starts from
      // what this call just observed rather than re-reading a frozen snapshot.
      credential: { ...credential, accounts: liveAccounts, lastSyncedAt: completedAt.toISOString(), consentExpiresAt: liveConsentExpiresAt, health },
      reconciliation: { ...reconciliation, health },
      consentExpiresAt: liveConsentExpiresAt,
      health,
    }
  }

  // Asks Enable Banking to end the session so a Finance Planner disconnect
  // also withdraws the provider-side consent, not just the local row. Never
  // throws: a failed/unreachable revoke must not block the user's local
  // disconnect, and must never be reported as confirmed when it wasn't --
  // same contract as GoCardlessProvider.disconnect().
  async disconnect(credential) {
    const sessionId = credential?.sessionId
    if (!sessionId) return { revoked: false, reason: 'not_applicable' }
    try {
      await jsonFetch(`${EB_BASE}/sessions/${sessionId}`, { method: 'DELETE', headers: enableBankingHeaders(this.env) }, providerPolicy(this.env))
      return { revoked: true }
    } catch (error) {
      if (error?.status === 404) return { revoked: true }
      return { revoked: false, reason: 'provider_error' }
    }
  }
}

async function paypalAccessToken(env) {
  const base = env.PAYPAL_ENV === 'live' ? PAYPAL_LIVE : PAYPAL_SANDBOX
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const token = await jsonFetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  }, providerPolicy(env))
  if (!token?.access_token) throw new Error('PayPal did not return an access token.')
  return { base, token }
}

function paypalBalanceRows(report) {
  if (Array.isArray(report?.balances)) return report.balances
  if (report?.balance && typeof report.balance === 'object') return [report.balance]
  return []
}

async function paypalEuroBalance({ base, accessToken, env, core }) {
  const url = new URL(`${base}/v1/reporting/balances`)
  url.searchParams.set('currency_code', 'EUR')
  const report = await jsonFetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'PayPal-Enforce-ISO8601-Format': 'true',
    },
  }, providerPolicy(env))
  const rows = paypalBalanceRows(report)
  const balance = rows.find((item) => item.currency === 'EUR' || item.total_balance?.currency_code === 'EUR')
  if (!balance) {
    if (rows.length === 0) return { balanceCents: 0, accountId: report?.account_id || 'paypal-eur', asOfTime: report?.as_of_time }
    throw new Error('PayPal reporting returned no valid EUR balance.')
  }
  if (balance.total_balance?.currency_code !== 'EUR' || balance.total_balance?.value === undefined) {
    throw new Error('PayPal reporting returned a malformed EUR balance.')
  }
  return {
    balanceCents: await core.normalizeProviderAmount(balance.total_balance.value),
    accountId: report?.account_id || 'paypal-eur',
    asOfTime: report?.as_of_time,
  }
}

class PayPalProvider extends OpenBankingProvider {
  constructor(env, core) { super({ id: 'paypal', displayName: 'PayPal', kind: 'wallet-account-information', env, core }) }
  mode() { return paypalMode(this.env) }
  isConfigured() {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) return false
    return this.mode() === 'owner' || Boolean(this.env.PAYPAL_PARTNER_MERCHANT_ID)
  }
  webhookRequired() { return this.mode() === 'partner' }
  describe() { return { ...super.describe(), mode: this.mode() } }

  async start({ state, redirectUri }) {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal credentials are not configured.')
    await this.core.validateReadOnlyScope('reporting,transactions,balances')
    const mode = this.mode()
    if (mode === 'owner') {
      const { base, token } = await paypalAccessToken(this.env)
      await paypalEuroBalance({ base, accessToken: token.access_token, env: this.env, core: this.core })
      return { redirectUrl: callbackUrl(redirectUri, 'paypal', state).toString(), credential: { mode: 'owner', pending: true, verifiedAt: new Date().toISOString() } }
    }

    if (!this.env.PAYPAL_PARTNER_MERCHANT_ID) {
      throw new Error('PayPal user authorization is unavailable because partner onboarding is not configured. Set PAYPAL_PARTNER_MERCHANT_ID before enabling partner mode.')
    }
    const base = this.env.PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com'
    const url = new URL(`${base}/bizsignup/partner/entry`)
    url.searchParams.set('partnerId', this.env.PAYPAL_PARTNER_MERCHANT_ID)
    url.searchParams.set('returnToPartnerUrl', callbackUrl(redirectUri, 'paypal', state).toString())
    url.searchParams.set('partnerClientId', this.env.PAYPAL_CLIENT_ID)
    url.searchParams.set('state', state)
    return { redirectUrl: url.toString(), credential: { mode: 'partner', pending: true } }
  }

  async sync(credential) {
    // Partner mode has no real per-merchant OAuth token exchange anywhere in
    // this codebase -- there is nothing in `credential` that identifies a
    // specific PayPal merchant. Syncing here would return the deployment's
    // own owner-mode PayPal data (paypalAccessToken() always uses the same
    // deployment-wide client credentials) to whichever user happens to have
    // a stored partner-mode connection -- a cross-tenant data exposure. Fail
    // closed and say so honestly, the same way disconnect() never claims
    // revocation it can't confirm, rather than silently leaking someone
    // else's PayPal account.
    if (credential.mode === 'partner') {
      throw new Error('PayPal partner-mode synchronization is not implemented: no per-merchant authorization exists yet, so Finance Planner cannot safely read this connection’s data without risking another user’s PayPal account. Disconnect and use the owner connection where available.')
    }
    const completedAt = new Date()
    await this.core.validateReadOnlyScope('reporting,transactions,balances')
    const { base, token } = await paypalAccessToken(this.env)
    const balance = await paypalEuroBalance({ base, accessToken: token.access_token, env: this.env, core: this.core })
    const window = syncWindow(credential.lastSyncedAt, completedAt)
    const transactions = []
    const seen = new Set()
    let page = 1
    let totalPages = 1
    do {
      const url = new URL(`${base}/v1/reporting/transactions`)
      url.searchParams.set('start_date', window.start.toISOString())
      url.searchParams.set('end_date', window.end.toISOString())
      url.searchParams.set('fields', 'transaction_info')
      url.searchParams.set('balance_affecting_records_only', 'Y')
      url.searchParams.set('page_size', '500')
      url.searchParams.set('page', String(page))
      const report = await jsonFetch(url, { headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' } }, providerPolicy(this.env))
      totalPages = Math.max(1, Number(report.total_pages || 1))
      if (!Number.isSafeInteger(totalPages) || totalPages > MAX_PAYPAL_PAGES) throw new Error(`PayPal report pagination exceeds safety limit: ${totalPages}`)
      if (!Array.isArray(report.transaction_details)) throw new Error('PayPal reporting returned an invalid transaction list.')
      for (const row of report.transaction_details) {
        const info = row.transaction_info ?? {}
        if (info.transaction_amount?.currency_code !== 'EUR' || !info.transaction_id || seen.has(info.transaction_id)) continue
        seen.add(info.transaction_id)
        const signedCents = await this.core.normalizeProviderAmount(info.transaction_amount.value)
        await normalizeSignedAmount(signedCents, this.env)
        transactions.push({ externalId: info.transaction_id, externalAccountId: 'paypal-eur', description: info.transaction_subject || info.transaction_note || info.transaction_event_code || 'PayPal', amountCents: signedCents, currency: 'EUR', bookingDate: String(info.transaction_initiation_date || '').slice(0, 10) || window.dateTo, pending: info.transaction_status === 'P' })
      }
      page += 1
    } while (page <= totalPages)
    const type = await this.core.normalizeProviderAccountType('CASH')
    const accounts = [{ externalId: 'paypal-eur', providerAccountId: balance.accountId, name: 'PayPal EUR', type, balanceCents: balance.balanceCents, currency: 'EUR' }]
    const reconciliation = { accountCount: accounts.length, pageCount: totalPages, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString(), balanceAsOf: balance.asOfTime }
    await validateProviderReconciliationWithCore(this.core, { accounts, transactions, reconciliation })
    const health = completedHealth({ completedAt, accounts, transactions })
    return {
      accounts,
      transactions,
      credential: { ...credential, lastSyncedAt: completedAt.toISOString(), health },
      reconciliation: { ...reconciliation, health },
      health,
    }
  }

  // Neither owner mode (the deployment's own app-level client-credential
  // access, not a per-user grant) nor partner mode (this codebase syncs
  // through the same client-credential flow, not a stored per-merchant user
  // token) hold a per-connection token that PayPal could revoke here -- the
  // credential this reads is Finance Planner's own record, not a PayPal
  // consent. Disconnecting always removes the local row regardless.
  async disconnect() { return { revoked: false, reason: 'not_applicable' } }
}

class UnavailableProvider extends OpenBankingProvider {
  constructor(id, displayName, env, core, reason) {
    super({ id, displayName, kind: 'unavailable', env, core, capabilities: { accountInformation: false, balances: false, transactions: false } })
    this.reason = reason
  }
  isAvailable() { return false }
  async start() { throw new Error(this.reason) }
  async sync() { throw new Error(this.reason) }
  describe() { return { ...super.describe(), reason: this.reason } }
}

export function createOpenBankingProviderRegistry(env = {}, suppliedCore, additionalProviders = []) {
  const core = suppliedCore || createBankingCore(env)
  return new OpenBankingProviderRegistry([
    new EnableBankingProvider(env, core),
    new GoCardlessProvider(env, core),
    new PayPalProvider(env, core),
    new UnavailableProvider('finapi', 'Bank (finAPI)', env, core, 'finAPI adapter is not configured.'),
    ...additionalProviders,
  ])
}

export async function startOpenBankingProvider({ env, provider, state, redirectUri, country = 'DE', institutionId, core }) {
  return createOpenBankingProviderRegistry(env, core).get(provider).start({ state, redirectUri, country, institutionId })
}

export async function syncOpenBankingProvider(provider, credential, env, suppliedCore) {
  return createOpenBankingProviderRegistry(env, suppliedCore).get(provider).sync(credential)
}

export async function startGoCardless({ env, state, redirectUri, country = 'DE', institutionId, core }) {
  return startOpenBankingProvider({ env, provider: 'gocardless', state, redirectUri, country, institutionId, core })
}

export async function syncGoCardless(credential, env, suppliedCore) {
  return syncOpenBankingProvider('gocardless', credential, env, suppliedCore)
}

export async function startPayPal({ env, state, redirectUri, core }) {
  return startOpenBankingProvider({ env, provider: 'paypal', state, redirectUri, core })
}

export async function syncPayPal(credential, env, suppliedCore) {
  return syncOpenBankingProvider('paypal', credential, env, suppliedCore)
}
