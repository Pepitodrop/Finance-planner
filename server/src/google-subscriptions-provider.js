const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke'
const GMAIL_MESSAGES = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_GMAIL_QUERY = '(from:googleplay-noreply@google.com OR from:payments-noreply@google.com OR from:googlepayments-noreply@google.com) (subscription OR renewal OR abonnement OR abo OR receipt) newer_than:3y'
const GMAIL_LIMITATIONS = Object.freeze([
  'Der Import basiert ausschließlich auf passenden Google-Zahlungs- und Abo-E-Mails im verbundenen Gmail-Postfach.',
  'Er ist keine vollständige oder autoritative Liste aller Google-Play-Abonnements und kann fehlende, gelöschte oder anders formulierte Belege nicht erkennen.',
  'Finance Planner liest nur Metadaten und kurze Nachrichtenausschnitte der eng gefilterten Treffer; Anhänge und vollständige E-Mail-Inhalte werden nicht geladen oder gespeichert.',
])

function requireHttps(value, name) {
  const url = new URL(String(value || ''))
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`)
  return url
}

function sourceMode(env) {
  const source = String(env.GOOGLE_SUBSCRIPTIONS_SOURCE || 'gmail').trim().toLowerCase()
  if (!['gmail', 'custom'].includes(source)) throw new Error('GOOGLE_SUBSCRIPTIONS_SOURCE must be gmail or custom.')
  return source
}

function providerTimeout(env) {
  const timeout = Number(env.PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 120_000) throw new Error('PROVIDER_TIMEOUT_MS is invalid.')
  return timeout
}

async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const text = await response.text()
    let payload = {}
    if (text) {
      try { payload = JSON.parse(text) } catch { throw new Error('Google subscription source returned malformed JSON.') }
    }
    if (!response.ok) throw new Error(`Google subscription request failed (${response.status}).`)
    return payload
  } finally {
    clearTimeout(timer)
  }
}

function oauthScopes(env, source) {
  const configured = String(env.GOOGLE_SUBSCRIPTIONS_SCOPES || 'openid email profile').split(/\s+/).filter(Boolean)
  const scopes = new Set(configured)
  if (source === 'gmail') scopes.add(GMAIL_READONLY_SCOPE)
  return [...scopes]
}

export function googleSubscriptionCapability(env = process.env) {
  const enabled = env.GOOGLE_SUBSCRIPTIONS_ENABLED === 'true'
  let source
  try { source = sourceMode(env) } catch (error) {
    return { enabled, source: 'invalid', configured: false, ready: false, reason: 'invalid_source', limitations: [error.message] }
  }
  const oauthConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
  const sourceConfigured = source === 'gmail' || Boolean(env.GOOGLE_SUBSCRIPTIONS_DATA_SOURCE)
  const configured = oauthConfigured && sourceConfigured
  return {
    enabled,
    source,
    configured,
    ready: enabled && configured,
    reason: !enabled ? 'disabled' : !oauthConfigured ? 'missing_oauth_configuration' : !sourceConfigured ? 'missing_data_source' : undefined,
    requiredScopes: oauthScopes(env, source),
    limitations: source === 'gmail' ? [...GMAIL_LIMITATIONS] : ['Die Daten stammen aus dem ausdrücklich konfigurierten, normalisierten HTTPS-Datenendpunkt.'],
  }
}

export function createGoogleSubscriptionAuthorizationUrl({ env = process.env, state, redirectUri }) {
  const capability = googleSubscriptionCapability(env)
  if (!capability.ready) throw new Error('Google subscription import is not configured.')
  const callback = requireHttps(redirectUri, 'Google subscription redirect URI')
  const url = new URL(GOOGLE_AUTH)
  url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
  url.searchParams.set('redirect_uri', callback.toString())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  url.searchParams.set('scope', capability.requiredScopes.join(' '))
  return url.toString()
}

export async function exchangeGoogleSubscriptionCode({ env = process.env, code, redirectUri }) {
  if (!code) throw new Error('Google authorization code is missing.')
  const callback = requireHttps(redirectUri, 'Google subscription redirect URI')
  const body = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID || '',
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: callback.toString(),
    grant_type: 'authorization_code',
  })
  const token = await requestJson(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, providerTimeout(env))
  if (!token.access_token) throw new Error('Google token response did not contain an access token.')
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type || 'Bearer',
    scope: token.scope,
    expiresAt: Number(token.expires_in) > 0 ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : undefined,
  }
}

export async function refreshGoogleSubscriptionToken(credential, env = process.env) {
  if (!credential?.refreshToken) throw new Error('Google refresh token is unavailable; reconnect the account.')
  const body = new URLSearchParams({
    refresh_token: credential.refreshToken,
    client_id: env.GOOGLE_CLIENT_ID || '',
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    grant_type: 'refresh_token',
  })
  const token = await requestJson(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, providerTimeout(env))
  if (!token.access_token) throw new Error('Google refresh response did not contain an access token.')
  return {
    ...credential,
    accessToken: token.access_token,
    tokenType: token.token_type || credential.tokenType || 'Bearer',
    scope: token.scope || credential.scope,
    expiresAt: Number(token.expires_in) > 0 ? new Date(Date.now() + Number(token.expires_in) * 1000).toISOString() : credential.expiresAt,
  }
}

function normalizeRecord(record) {
  const interval = ['weekly', 'monthly', 'quarterly', 'yearly'].includes(record?.billingInterval) ? record.billingInterval : null
  const status = ['active', 'paused', 'cancelled', 'expired'].includes(record?.status) ? record.status : null
  if (!record?.externalId || !record?.product || !Number.isSafeInteger(record?.amountCents) || record.amountCents < 0 || record.currency !== 'EUR' || !interval || !status) {
    throw new Error('Google subscription source returned an invalid record.')
  }
  if (record.nextChargeDate && !/^\d{4}-\d{2}-\d{2}$/.test(record.nextChargeDate)) throw new Error('Google subscription source returned an invalid next-charge date.')
  return {
    externalId: String(record.externalId),
    provider: String(record.provider || 'Google'),
    product: String(record.product).trim().slice(0, 160),
    amountCents: record.amountCents,
    currency: 'EUR',
    billingInterval: interval,
    nextChargeDate: record.nextChargeDate,
    status,
  }
}

function header(message, name) {
  const target = name.toLowerCase()
  return String(message?.payload?.headers?.find((item) => String(item?.name || '').toLowerCase() === target)?.value || '')
}

function trustedGoogleSender(value) {
  const match = String(value).match(/<?([A-Z0-9._%+-]+@([A-Z0-9.-]+))>?/i)
  const domain = match?.[2]?.toLowerCase()
  return Boolean(domain && (domain === 'google.com' || domain.endsWith('.google.com')))
}

function amountCentsFromText(text) {
  const patterns = [
    /(?:EUR\s*|€\s*)(\d{1,7})(?:[.,](\d{2}))?/i,
    /(\d{1,7})[.,](\d{2})\s*(?:EUR|€)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const cents = Number(match[1]) * 100 + Number(match[2] || 0)
    if (Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000) return cents
  }
  return null
}

function billingIntervalFromText(text) {
  if (/\b(?:weekly|week|wöchentlich|woche)\b/i.test(text)) return 'weekly'
  if (/\b(?:quarterly|quarter|vierteljährlich|quartal)\b/i.test(text)) return 'quarterly'
  if (/\b(?:yearly|annual(?:ly)?|year|jährlich|jahr)\b/i.test(text)) return 'yearly'
  if (/\b(?:monthly|month|monatlich|monat)\b/i.test(text)) return 'monthly'
  return null
}

function subscriptionStatusFromText(text) {
  if (/\b(?:cancelled|canceled|gekündigt|storniert|beendet)\b/i.test(text)) return 'cancelled'
  if (/\b(?:expired|abgelaufen)\b/i.test(text)) return 'expired'
  if (/\b(?:paused|pausiert)\b/i.test(text)) return 'paused'
  return 'active'
}

function productFromReceipt(subject, snippet) {
  const source = `${subject} ${snippet}`.replace(/\s+/g, ' ').trim()
  const quoted = source.match(/[“"']([^“"']{2,120})[”"']/)?.[1]
  if (quoted) return quoted.trim()
  const cleaned = subject
    .replace(/\b(?:google\s*play|google\s*payments?|receipt|order|subscription|renewal|payment|beleg|bestellung|abo|abonnement|verlängerung)\b/gi, ' ')
    .replace(/[#:]?\s*[A-Z0-9-]{8,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned || subject || 'Google-Abonnement aus Gmail-Beleg').slice(0, 160)
}

function normalizeGmailReceipt(message) {
  const from = header(message, 'From')
  const subject = header(message, 'Subject').trim()
  const snippet = String(message?.snippet || '').trim().slice(0, 500)
  const searchable = `${subject} ${snippet}`
  if (!trustedGoogleSender(from)) return null
  if (!/\b(?:subscription|renewal|abonnement|abo|verlängerung|recurring)\b/i.test(searchable)) return null
  const amountCents = amountCentsFromText(searchable)
  const billingInterval = billingIntervalFromText(searchable)
  if (amountCents === null || !billingInterval) return null
  const product = productFromReceipt(subject, snippet)
  const internalDate = Number(message?.internalDate)
  return {
    receiptTimestamp: Number.isFinite(internalDate) ? internalDate : 0,
    record: normalizeRecord({
      externalId: `gmail:${message.id}`,
      provider: 'Google Play (Gmail-Beleg)',
      product,
      amountCents,
      currency: 'EUR',
      billingInterval,
      status: subscriptionStatusFromText(searchable),
    }),
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

function gmailQuery(env) {
  const query = String(env.GOOGLE_SUBSCRIPTIONS_GMAIL_QUERY || DEFAULT_GMAIL_QUERY).trim()
  if (!query || query.length > 500 || /[\u0000-\u001F\u007F]/.test(query)) throw new Error('GOOGLE_SUBSCRIPTIONS_GMAIL_QUERY is invalid.')
  return query
}

function gmailMaxMessages(env) {
  const value = Number(env.GOOGLE_SUBSCRIPTIONS_MAX_MESSAGES || 100)
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('GOOGLE_SUBSCRIPTIONS_MAX_MESSAGES must be between 1 and 100.')
  return value
}

async function syncGmailReceipts(credential, env) {
  const authorization = `${credential.tokenType || 'Bearer'} ${credential.accessToken}`
  const listUrl = new URL(GMAIL_MESSAGES)
  listUrl.searchParams.set('q', gmailQuery(env))
  listUrl.searchParams.set('maxResults', String(gmailMaxMessages(env)))
  const list = await requestJson(listUrl, { headers: { Authorization: authorization, Accept: 'application/json' } }, providerTimeout(env))
  if (list.messages !== undefined && !Array.isArray(list.messages)) throw new Error('Gmail returned an invalid message list.')
  const messages = await mapLimit(list.messages || [], 5, async (entry) => {
    if (!entry?.id || !/^[A-Za-z0-9_-]+$/.test(entry.id)) throw new Error('Gmail returned an invalid message identifier.')
    const detailUrl = new URL(`${GMAIL_MESSAGES}/${encodeURIComponent(entry.id)}`)
    detailUrl.searchParams.set('format', 'metadata')
    for (const name of ['Subject', 'From', 'Date']) detailUrl.searchParams.append('metadataHeaders', name)
    return requestJson(detailUrl, { headers: { Authorization: authorization, Accept: 'application/json' } }, providerTimeout(env))
  })
  const receipts = messages.map(normalizeGmailReceipt).filter(Boolean)
  const unique = new Map()
  for (const candidate of receipts) {
    const record = candidate.record
    const key = [record.product.toLocaleLowerCase('de-DE'), record.amountCents, record.billingInterval].join('|')
    const existing = unique.get(key)
    if (!existing || candidate.receiptTimestamp > existing.receiptTimestamp) unique.set(key, candidate)
  }
  return { subscriptions: [...unique.values()].map((candidate) => candidate.record), limitations: [...GMAIL_LIMITATIONS] }
}

export async function syncGoogleSubscriptionSource(credential, env = process.env) {
  const capability = googleSubscriptionCapability(env)
  if (!capability.ready) return { connected: false, subscriptions: [], unavailableReason: capability.reason, capability }
  let current = credential
  if (!current?.accessToken) throw new Error('Google subscription connection is incomplete.')
  if (current.expiresAt && Date.parse(current.expiresAt) <= Date.now() + 120_000) current = await refreshGoogleSubscriptionToken(current, env)
  const source = capability.source
  let subscriptions
  let limitations = capability.limitations
  if (source === 'gmail') {
    const result = await syncGmailReceipts(current, env)
    subscriptions = result.subscriptions
    limitations = result.limitations
  } else {
    const endpoint = requireHttps(env.GOOGLE_SUBSCRIPTIONS_DATA_SOURCE, 'Google subscription data source')
    const payload = await requestJson(endpoint, { headers: { Authorization: `${current.tokenType || 'Bearer'} ${current.accessToken}`, Accept: 'application/json' } }, providerTimeout(env))
    if (!Array.isArray(payload.subscriptions)) throw new Error('Google subscription source response is incomplete.')
    const unique = new Map()
    for (const item of payload.subscriptions) {
      const normalized = normalizeRecord(item)
      unique.set(normalized.externalId, normalized)
    }
    subscriptions = [...unique.values()]
  }
  return {
    connected: true,
    source,
    lastSyncAt: new Date().toISOString(),
    subscriptions,
    limitations,
    credential: current,
  }
}

export async function revokeGoogleSubscriptionAccess(credential, env = process.env) {
  const token = credential?.refreshToken || credential?.accessToken
  if (!token) return false
  const url = new URL(GOOGLE_REVOKE)
  url.searchParams.set('token', token)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), providerTimeout(env))
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: controller.signal })
    if (!response.ok && response.status !== 400) throw new Error(`Google revocation failed (${response.status}).`)
    return response.ok
  } finally {
    clearTimeout(timer)
  }
}
