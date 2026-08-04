import { assessBankConnectionHealth, chooseBankSyncBackoff } from './bank-sync-health.js'
import { CobolBankingCore } from './cobol-banking-core.js'
import { normalizeSignedAmount } from './cobol-engine.js'

const GC_BASE = 'https://bankaccountdata.gocardless.com/api/v2'
const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com'
const PAYPAL_LIVE = 'https://api-m.paypal.com'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const DEFAULT_SYNC_DAYS = 31
const DEFAULT_OVERLAP_DAYS = 3
const GOCARDLESS_CONSENT_DAYS = 90
const CONSENT_EXPIRY_SAFETY_MS = 5 * 60_000
const MAX_PAYPAL_PAGES = 100
const MAX_RETRY_DELAY_MS = 30_000

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

export function providerAccountTypeAlias(account = {}) {
  const code = String(account.cashAccountType || account.type || '').trim().toUpperCase()
  if (['SVGS', 'SAVINGS', 'DEPOSIT'].includes(code)) return 'savings'
  if (['CASH'].includes(code)) return 'cash'
  if (['CARD', 'CREDITCARD', 'CREDIT-CARD'].includes(code)) return 'credit-card'
  if (['INVE', 'INVESTMENT', 'BROKERAGE', 'TRAS'].includes(code)) return 'investment'
  return 'checking'
}

export async function normalizeProviderAccountType(account, env = {}, suppliedCore) {
  const core = suppliedCore || createBankingCore(env)
  const code = String(account?.cashAccountType || account?.type || '')
  if (typeof core.normalizeProviderAccountType === 'function') return core.normalizeProviderAccountType(code)
  return core.normalizeAccountType(providerAccountTypeAlias(account))
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

export async function jsonFetch(url, options = {}, policy = {}) {
  const timeoutMs = Number(policy.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const retries = Number(policy.retries ?? DEFAULT_RETRIES)
  let lastError

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      const text = await response.text()
      let body = {}
      if (text) {
        try { body = JSON.parse(text) } catch { body = { detail: text.slice(0, 300) } }
      }
      if (response.ok) return body

      const error = new Error(`${response.status} ${body.detail ?? body.error_description ?? body.error ?? 'Provider request failed'}`)
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === retries) throw error

      lastError = error
      const providerDelay = retryDelayMs(response.headers.get('retry-after'))
      await sleep(chooseBankSyncBackoff(attempt, providerDelay))
      continue
    } catch (error) {
      lastError = error
      if (error?.name === 'AbortError' && attempt < retries) {
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

export function decimalToCents(value) {
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) throw new Error('Provider returned an invalid monetary amount.')
  const [, sign, units, fraction = ''] = match
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, '0'))
  const signed = sign ? -cents : cents
  if (!Number.isSafeInteger(signed)) throw new Error('Provider returned an invalid monetary amount.')
  return signed
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
  constructor({ id, kind, env, core, capabilities = READ_ONLY_CAPABILITIES }) {
    this.id = id
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

  isConfigured() { return false }
  async start() { throw new Error(`${this.id} provider start is not implemented.`) }
  async sync() { throw new Error(`${this.id} provider sync is not implemented.`) }

  describe() {
    return {
      id: this.id,
      kind: this.kind,
      configured: this.isConfigured(),
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
  configured() { return this.list().filter((provider) => provider.configured) }
}

export async function gocardlessToken(env) {
  const token = await jsonFetch(`${GC_BASE}/token/new/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret_id: env.GOCARDLESS_SECRET_ID, secret_key: env.GOCARDLESS_SECRET_KEY }),
  }, providerPolicy(env))
  const issuedAt = new Date()
  return {
    ...token,
    issuedAt: issuedAt.toISOString(),
    accessExpiresAt: Number(token.access_expires) > 0 ? new Date(issuedAt.getTime() + Number(token.access_expires) * 1000).toISOString() : undefined,
  }
}

class GoCardlessProvider extends OpenBankingProvider {
  constructor(env, core) { super({ id: 'gocardless', kind: 'psd2-account-information', env, core }) }
  isConfigured() { return Boolean(this.env.GOCARDLESS_SECRET_ID && this.env.GOCARDLESS_SECRET_KEY) }

  async start({ state, redirectUri, country = 'DE' }) {
    if (!this.isConfigured()) throw new Error('GoCardless credentials are not configured.')
    await this.core.validateReadOnlyScope('balances,details,transactions')
    const token = await gocardlessToken(this.env)
    const policy = providerPolicy(this.env)
    const institutions = await jsonFetch(`${GC_BASE}/institutions/?country=${encodeURIComponent(country)}`, { headers: { Authorization: `Bearer ${token.access}` } }, policy)
    const institutionId = this.env.GOCARDLESS_INSTITUTION_ID || institutions[0]?.id
    if (!institutionId) throw new Error('No GoCardless institution is available for this country.')
    const agreement = await jsonFetch(`${GC_BASE}/agreements/enduser/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ institution_id: institutionId, max_historical_days: 90, access_valid_for_days: GOCARDLESS_CONSENT_DAYS, access_scope: ['balances', 'details', 'transactions'] }),
    }, policy)
    const requisition = await jsonFetch(`${GC_BASE}/requisitions/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect: redirectUri, institution_id: institutionId, agreement: agreement.id, reference: state, user_language: 'DE' }),
    }, policy)
    return {
      redirectUrl: requisition.link,
      credential: {
        requisitionId: requisition.id,
        agreementId: agreement.id,
        token,
        institutionId,
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
      accounts.push({ externalId: accountId, name: account.name || account.product || account.iban || 'Bankkonto', type, balanceCents, currency: 'EUR' })
      for (const [pending, rows] of [[false, tx.transactions?.booked ?? []], [true, tx.transactions?.pending ?? []]]) {
        for (const item of rows) {
          if (item.transactionAmount?.currency !== 'EUR') continue
          const signedCents = await this.core.normalizeProviderAmount(item.transactionAmount.amount)
          await normalizeSignedAmount(signedCents, this.env)
          const externalId = item.transactionId || `${accountId}:${item.bookingDate || item.valueDate}:${item.transactionAmount.amount}:${item.remittanceInformationUnstructured || ''}`
          if (seen.has(externalId)) continue
          seen.add(externalId)
          transactions.push({ externalId, externalAccountId: accountId, description: item.creditorName || item.debtorName || item.remittanceInformationUnstructured || item.additionalInformation || 'Banktransaktion', amountCents: signedCents, currency: 'EUR', bookingDate: item.bookingDate || item.valueDate || window.dateTo, pending })
        }
      }
    }
    const reconciliation = { accountCount: accounts.length, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString() }
    validateProviderReconciliation({ accounts, transactions, reconciliation })
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
}

async function paypalAccessToken(env) {
  const base = env.PAYPAL_ENV === 'live' ? PAYPAL_LIVE : PAYPAL_SANDBOX
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const token = await jsonFetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }, providerPolicy(env))
  return { base, token }
}

class PayPalProvider extends OpenBankingProvider {
  constructor(env, core) { super({ id: 'paypal', kind: 'wallet-account-information', env, core }) }
  mode() { return paypalMode(this.env) }
  isConfigured() {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) return false
    return this.mode() === 'owner' || Boolean(this.env.PAYPAL_PARTNER_MERCHANT_ID)
  }

  async start({ state, redirectUri }) {
    if (!this.env.PAYPAL_CLIENT_ID || !this.env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal credentials are not configured.')
    await this.core.validateReadOnlyScope('reporting,transactions')
    const mode = this.mode()
    if (mode === 'owner') {
      const callback = new URL('/api/connectors/callback', new URL(redirectUri).origin)
      callback.searchParams.set('provider', 'paypal')
      callback.searchParams.set('state', state)
      return { redirectUrl: callback.toString(), credential: { mode: 'owner', pending: true } }
    }

    if (!this.env.PAYPAL_PARTNER_MERCHANT_ID) {
      throw new Error('PayPal user authorization is unavailable because partner onboarding is not configured. Set PAYPAL_PARTNER_MERCHANT_ID before enabling partner mode.')
    }
    const base = this.env.PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com'
    const url = new URL(`${base}/bizsignup/partner/entry`)
    url.searchParams.set('partnerId', this.env.PAYPAL_PARTNER_MERCHANT_ID)
    url.searchParams.set('returnToPartnerUrl', redirectUri)
    url.searchParams.set('partnerClientId', this.env.PAYPAL_CLIENT_ID)
    url.searchParams.set('state', state)
    return { redirectUrl: url.toString(), credential: { mode: 'partner', pending: true } }
  }

  async sync(credential) {
    const completedAt = new Date()
    await this.core.validateReadOnlyScope('reporting,transactions')
    const { base, token } = await paypalAccessToken(this.env)
    const window = syncWindow(credential.lastSyncedAt, completedAt)
    const transactions = []
    const seen = new Set()
    let balanceCents = 0
    let page = 1
    let totalPages = 1
    do {
      const url = new URL(`${base}/v1/reporting/transactions`)
      url.searchParams.set('start_date', window.start.toISOString())
      url.searchParams.set('end_date', window.end.toISOString())
      url.searchParams.set('fields', 'all')
      url.searchParams.set('page_size', '500')
      url.searchParams.set('page', String(page))
      const report = await jsonFetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } }, providerPolicy(this.env))
      totalPages = Math.max(1, Number(report.total_pages || 1))
      if (!Number.isSafeInteger(totalPages) || totalPages > MAX_PAYPAL_PAGES) throw new Error(`PayPal report pagination exceeds safety limit: ${totalPages}`)
      for (const row of report.transaction_details ?? []) {
        const info = row.transaction_info ?? {}
        if (info.transaction_amount?.currency_code !== 'EUR' || !info.transaction_id || seen.has(info.transaction_id)) continue
        seen.add(info.transaction_id)
        const signedCents = await this.core.normalizeProviderAmount(info.transaction_amount.value)
        await normalizeSignedAmount(signedCents, this.env)
        balanceCents += signedCents
        transactions.push({ externalId: info.transaction_id, externalAccountId: 'paypal-eur', description: info.transaction_subject || info.transaction_note || info.transaction_event_code || 'PayPal', amountCents: signedCents, currency: 'EUR', bookingDate: String(info.transaction_initiation_date || '').slice(0, 10) || window.dateTo, pending: info.transaction_status === 'P' })
      }
      page += 1
    } while (page <= totalPages)
    const type = await this.core.normalizeProviderAccountType('CASH')
    const accounts = [{ externalId: 'paypal-eur', name: 'PayPal EUR', type, balanceCents, currency: 'EUR' }]
    const reconciliation = { pageCount: totalPages, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString() }
    validateProviderReconciliation({ accounts, transactions, reconciliation })
    const health = completedHealth({ completedAt, accounts, transactions })
    return {
      accounts,
      transactions,
      credential: { ...credential, lastSyncedAt: completedAt.toISOString(), health },
      reconciliation: { ...reconciliation, health },
      health,
    }
  }
}

class UnavailableProvider extends OpenBankingProvider {
  constructor(id, env, core, reason) {
    super({ id, kind: 'unavailable', env, core, capabilities: { accountInformation: false, balances: false, transactions: false } })
    this.reason = reason
  }
  async start() { throw new Error(this.reason) }
  async sync() { throw new Error(this.reason) }
  describe() { return { ...super.describe(), reason: this.reason } }
}

export function createOpenBankingProviderRegistry(env = {}, suppliedCore, additionalProviders = []) {
  const core = suppliedCore || createBankingCore(env)
  return new OpenBankingProviderRegistry([
    new GoCardlessProvider(env, core),
    new PayPalProvider(env, core),
    new UnavailableProvider('finapi', env, core, 'finAPI adapter is not configured.'),
    ...additionalProviders,
  ])
}

export async function startGoCardless({ env, state, redirectUri, country = 'DE' }) {
  return createOpenBankingProviderRegistry(env).get('gocardless').start({ state, redirectUri, country })
}

export async function syncGoCardless(credential, env, suppliedCore) {
  return createOpenBankingProviderRegistry(env, suppliedCore).get('gocardless').sync(credential)
}

export async function startPayPal({ env, state, redirectUri }) {
  return createOpenBankingProviderRegistry(env).get('paypal').start({ state, redirectUri })
}

export async function syncPayPal(credential, env, suppliedCore) {
  return createOpenBankingProviderRegistry(env, suppliedCore).get('paypal').sync(credential)
}
