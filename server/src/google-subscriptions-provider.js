const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token'
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke'
const DEFAULT_TIMEOUT_MS = 15_000

function requireHttps(value, name) {
  const url = new URL(String(value || ''))
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS.`)
  return url
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

export function googleSubscriptionCapability(env = process.env) {
  const enabled = env.GOOGLE_SUBSCRIPTIONS_ENABLED === 'true'
  const configured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_SUBSCRIPTIONS_DATA_SOURCE)
  return {
    enabled,
    configured,
    ready: enabled && configured,
    reason: !enabled ? 'disabled' : !configured ? 'missing_configuration' : undefined,
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
  url.searchParams.set('scope', env.GOOGLE_SUBSCRIPTIONS_SCOPES || 'openid email profile')
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
  }, Number(env.PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS))
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
  }, Number(env.PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS))
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
    product: String(record.product),
    amountCents: record.amountCents,
    currency: 'EUR',
    billingInterval: interval,
    nextChargeDate: record.nextChargeDate,
    status,
  }
}

export async function syncGoogleSubscriptionSource(credential, env = process.env) {
  const capability = googleSubscriptionCapability(env)
  if (!capability.ready) return { connected: false, subscriptions: [], unavailableReason: capability.reason }
  let current = credential
  if (!current?.accessToken) throw new Error('Google subscription connection is incomplete.')
  if (current.expiresAt && Date.parse(current.expiresAt) <= Date.now() + 120_000) current = await refreshGoogleSubscriptionToken(current, env)
  const source = requireHttps(env.GOOGLE_SUBSCRIPTIONS_DATA_SOURCE, 'Google subscription data source')
  const payload = await requestJson(source, { headers: { Authorization: `${current.tokenType || 'Bearer'} ${current.accessToken}`, Accept: 'application/json' } }, Number(env.PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS))
  if (!Array.isArray(payload.subscriptions)) throw new Error('Google subscription source response is incomplete.')
  const unique = new Map()
  for (const item of payload.subscriptions) {
    const normalized = normalizeRecord(item)
    unique.set(normalized.externalId, normalized)
  }
  return { connected: true, lastSyncAt: new Date().toISOString(), subscriptions: [...unique.values()], credential: current }
}

export async function revokeGoogleSubscriptionAccess(credential, env = process.env) {
  const token = credential?.refreshToken || credential?.accessToken
  if (!token) return false
  const url = new URL(GOOGLE_REVOKE)
  url.searchParams.set('token', token)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Number(env.PROVIDER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS))
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: controller.signal })
    if (!response.ok && response.status !== 400) throw new Error(`Google revocation failed (${response.status}).`)
    return response.ok
  } finally {
    clearTimeout(timer)
  }
}
