import { normalizeSignedAmount } from './cobol-engine.js'

const GC_BASE = 'https://bankaccountdata.gocardless.com/api/v2'
const PAYPAL_SANDBOX = 'https://api-m.sandbox.paypal.com'
const PAYPAL_LIVE = 'https://api-m.paypal.com'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_RETRIES = 2
const DEFAULT_SYNC_DAYS = 31
const DEFAULT_OVERLAP_DAYS = 3
const MAX_PAYPAL_PAGES = 100
const MAX_RETRY_DELAY_MS = 30_000

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10) }

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
      await sleep(providerDelay ?? 250 * (2 ** attempt))
      continue
    } catch (error) {
      lastError = error
      if (error?.name === 'AbortError' && attempt < retries) {
        await sleep(250 * (2 ** attempt))
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

export async function startGoCardless({ env, state, redirectUri, country = 'DE' }) {
  if (!env.GOCARDLESS_SECRET_ID || !env.GOCARDLESS_SECRET_KEY) throw new Error('GoCardless credentials are not configured.')
  const token = await gocardlessToken(env)
  const policy = providerPolicy(env)
  const institutions = await jsonFetch(`${GC_BASE}/institutions/?country=${encodeURIComponent(country)}`, { headers: { Authorization: `Bearer ${token.access}` } }, policy)
  const institutionId = env.GOCARDLESS_INSTITUTION_ID || institutions[0]?.id
  if (!institutionId) throw new Error('No GoCardless institution is available for this country.')
  const agreement = await jsonFetch(`${GC_BASE}/agreements/enduser/`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ institution_id: institutionId, max_historical_days: 90, access_valid_for_days: 90, access_scope: ['balances', 'details', 'transactions'] }),
  }, policy)
  const requisition = await jsonFetch(`${GC_BASE}/requisitions/`, {
    method: 'POST', headers: { Authorization: `Bearer ${token.access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect: redirectUri, institution_id: institutionId, agreement: agreement.id, reference: state, user_language: 'DE' }),
  }, policy)
  return { redirectUrl: requisition.link, credential: { requisitionId: requisition.id, token, institutionId } }
}

export async function syncGoCardless(credential, env) {
  const completedAt = new Date()
  let token = credential.token
  if (!tokenIsUsable(token, completedAt.getTime())) token = await gocardlessToken(env)
  const policy = providerPolicy(env)
  const requisition = await jsonFetch(`${GC_BASE}/requisitions/${credential.requisitionId}/`, { headers: { Authorization: `Bearer ${token.access}` } }, policy)
  if (requisition.status !== 'LN') throw new Error(`GoCardless consent is not ready: ${requisition.status || 'unknown'}`)
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
    accounts.push({ externalId: accountId, name: account.name || account.product || account.iban || 'Bankkonto', type: 'checking', balanceCents: decimalToCents(balance), currency: 'EUR' })
    for (const [pending, rows] of [[false, tx.transactions?.booked ?? []], [true, tx.transactions?.pending ?? []]]) {
      for (const item of rows) {
        if (item.transactionAmount?.currency !== 'EUR') continue
        const signedCents = decimalToCents(item.transactionAmount.amount)
        await normalizeSignedAmount(signedCents, env)
        const externalId = item.transactionId || `${accountId}:${item.bookingDate || item.valueDate}:${item.transactionAmount.amount}:${item.remittanceInformationUnstructured || ''}`
        if (seen.has(externalId)) continue
        seen.add(externalId)
        transactions.push({ externalId, externalAccountId: accountId, description: item.creditorName || item.debtorName || item.remittanceInformationUnstructured || item.additionalInformation || 'Banktransaktion', amountCents: signedCents, currency: 'EUR', bookingDate: item.bookingDate || item.valueDate || window.dateTo, pending })
      }
    }
  }
  return { accounts, transactions, credential: { ...credential, token, lastSyncedAt: completedAt.toISOString() }, reconciliation: { accountCount: accounts.length, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString() }, consentExpiresAt: undefined }
}

async function paypalAccessToken(env) {
  const base = env.PAYPAL_ENV === 'live' ? PAYPAL_LIVE : PAYPAL_SANDBOX
  const auth = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64')
  const token = await jsonFetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }, providerPolicy(env))
  return { base, token }
}

export async function startPayPal({ env, state, redirectUri }) {
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) throw new Error('PayPal credentials are not configured.')
  if (!env.PAYPAL_PARTNER_MERCHANT_ID) return { redirectUrl: `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}connector=paypal&state=${encodeURIComponent(state)}`, credential: { mode: 'owner-reporting' } }
  const base = env.PAYPAL_ENV === 'live' ? 'https://www.paypal.com' : 'https://www.sandbox.paypal.com'
  const url = new URL(`${base}/bizsignup/partner/entry`)
  url.searchParams.set('partnerId', env.PAYPAL_PARTNER_MERCHANT_ID)
  url.searchParams.set('returnToPartnerUrl', redirectUri)
  url.searchParams.set('partnerClientId', env.PAYPAL_CLIENT_ID)
  url.searchParams.set('state', state)
  return { redirectUrl: url.toString(), credential: { mode: 'partner', pending: true } }
}

export async function syncPayPal(credential, env) {
  const completedAt = new Date()
  const { base, token } = await paypalAccessToken(env)
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
    const report = await jsonFetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } }, providerPolicy(env))
    totalPages = Math.max(1, Number(report.total_pages || 1))
    if (!Number.isSafeInteger(totalPages) || totalPages > MAX_PAYPAL_PAGES) throw new Error(`PayPal report pagination exceeds safety limit: ${totalPages}`)
    for (const row of report.transaction_details ?? []) {
      const info = row.transaction_info ?? {}
      if (info.transaction_amount?.currency_code !== 'EUR' || !info.transaction_id || seen.has(info.transaction_id)) continue
      seen.add(info.transaction_id)
      const signedCents = decimalToCents(info.transaction_amount.value)
      await normalizeSignedAmount(signedCents, env)
      balanceCents += signedCents
      transactions.push({ externalId: info.transaction_id, externalAccountId: 'paypal-eur', description: info.transaction_subject || info.transaction_note || info.transaction_event_code || 'PayPal', amountCents: signedCents, currency: 'EUR', bookingDate: String(info.transaction_initiation_date || '').slice(0, 10) || window.dateTo, pending: info.transaction_status === 'P' })
    }
    page += 1
  } while (page <= totalPages)
  return { accounts: [{ externalId: 'paypal-eur', name: 'PayPal EUR', type: 'cash', balanceCents, currency: 'EUR' }], transactions, credential: { ...credential, lastSyncedAt: completedAt.toISOString() }, reconciliation: { pageCount: totalPages, transactionCount: transactions.length, dateFrom: window.dateFrom, dateTo: window.dateTo, syncedAt: completedAt.toISOString() } }
}
