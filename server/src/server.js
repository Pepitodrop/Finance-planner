import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import { createAiRouter } from './ai-router.js'
import { createAuthRouter } from './auth-router.js'
import { createConnectorStore } from './database.js'
import { createRateLimiters } from './distributed-rate-limiter.js'
import { createFinanceRouter } from './finance-router.js'
import { createSession, issueState, verifySession, verifyState } from './security.js'
import { startGoCardless, startPayPal, syncGoCardless, syncPayPal } from './providers.js'
import { HttpError, SlidingWindowRateLimiter, classifyError, clientIp, requestId, validateProductionConfig } from './runtime-security.js'
import { bankProductionCapabilities, processWebhook } from './webhook-security.js'

const env = process.env
const port = Number(env.PORT || 8787)
const host = env.HOST || '127.0.0.1'
const origin = env.APP_ORIGIN || 'http://localhost:5173'
const sessionSecret = env.SESSION_SECRET || ''
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
if (!['127.0.0.1', '0.0.0.0', '::'].includes(host)) throw new Error('HOST must be 127.0.0.1, 0.0.0.0, or ::.')
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')
validateProductionConfig(env, origin)

const persistence = await createConnectorStore(env)
const store = persistence.store
const bankCapabilities = () => bankProductionCapabilities(env, persistence)
let ready = true
let shuttingDown = false
const generalLimit = Number(env.RATE_LIMIT_PER_MINUTE || 120)
const sensitiveLimit = Number(env.SENSITIVE_RATE_LIMIT_PER_MINUTE || 20)
const distributedLimiters = createRateLimiters({
  persistence,
  generalLimit,
  sensitiveLimit,
  windowMs: 60_000,
  requireDistributed: env.NODE_ENV === 'production' && env.PUBLIC_DEPLOYMENT === 'true',
})
const generalLimiter = distributedLimiters?.general || new SlidingWindowRateLimiter({ limit: generalLimit, windowMs: 60_000 })
const sensitiveLimiter = distributedLimiters?.sensitive || new SlidingWindowRateLimiter({ limit: sensitiveLimit, windowMs: 60_000 })
const activeSyncs = new Map()
const syncReplayCache = new Map()
const SYNC_REPLAY_TTL_MS = 2 * 60_000

function send(response, status, payload, headers = {}) {
  const securityHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  }
  if (origin.startsWith('https://')) securityHeaders['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  response.writeHead(status, securityHeaders)
  response.end(JSON.stringify(payload))
}

async function body(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType && contentType !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Content-Type must be application/json.')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new HttpError(413, 'payload_too_large', 'Request body too large.')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json', 'Invalid JSON request body.')
  }
}

function cookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((entry) => entry.length === 2))
}

function userId(request) {
  const token = cookies(request).fp_session
  if (!token) throw new Error('Authentication required.')
  return verifySession(token, sessionSecret)
}

function cors(request, response) {
  const requestOrigin = request.headers.origin
  if (requestOrigin && requestOrigin !== origin) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Credentials', 'true')
  response.setHeader('Access-Control-Expose-Headers', 'X-Request-ID, Idempotency-Replayed, Retry-After')
  response.setHeader('Vary', 'Origin')
  return true
}

async function rateLimit(request, response, pathname) {
  const remote = env.TRUST_PROXY === 'true' ? clientIp(request) : request.socket?.remoteAddress || 'unknown'
  const sensitive = /^\/api\/(auth|session|connectors|finance|ai)/.test(pathname)
  const limiter = sensitive ? sensitiveLimiter : generalLimiter
  const result = await limiter.consume(`${remote}:${sensitive ? 'sensitive' : 'general'}`)
  response.setHeader('RateLimit-Limit', limiter.limit)
  response.setHeader('RateLimit-Remaining', result.remaining)
  response.setHeader('RateLimit-Reset', Math.ceil(result.resetAt / 1000))
  if (result.allowed) return true
  send(response, 429, { error: { code: 'rate_limited', message: 'Too many requests.' }, requestId: response.getHeader('X-Request-ID') }, { 'Retry-After': result.retryAfter })
  return false
}

function connection(provider, stored, error) {
  return {
    id: provider,
    provider,
    displayName: provider === 'paypal' ? 'PayPal' : provider === 'gocardless' ? 'Bank (GoCardless)' : 'Bank (finAPI)',
    status: error ? 'error' : stored ? 'connected' : 'disconnected',
    lastSyncAt: stored?.lastSyncAt,
    consentExpiresAt: stored?.consentExpiresAt,
    error,
  }
}

async function start(provider, request, response) {
  const user = userId(request)
  const input = await body(request)
  const redirect = new URL(String(input.redirectUri || origin))
  if (redirect.origin !== origin) throw new HttpError(400, 'invalid_redirect', 'Invalid redirect origin.')
  const consentId = randomUUID()
  const state = issueState(user, provider, sessionSecret, { consentId, redirectUri: redirect.toString() })
  const claims = verifyState(state, provider, sessionSecret)
  const result = provider === 'gocardless'
    ? await startGoCardless({ env, state, redirectUri: redirect.toString(), country: input.country || 'DE' })
    : provider === 'paypal'
      ? await startPayPal({ env, state, redirectUri: redirect.toString() })
      : (() => { throw new HttpError(501, 'provider_unavailable', 'finAPI adapter is not configured.') })()
  await store.createConnectionSetup({
    userId: user,
    provider,
    consentId,
    redirectUri: redirect.toString(),
    nonce: claims.nonce,
    expiresAt: claims.exp * 1000,
    connection: { ...result.credential, consentId, redirectUri: redirect.toString(), state, createdAt: new Date().toISOString() },
  })
  send(response, 200, { redirectUrl: result.redirectUrl })
}

async function buildSyncPayload(user) {
  const results = []
  for (const provider of ['gocardless', 'finapi', 'paypal']) {
    const stored = await store.get(user, provider)
    if (!stored) continue
    try {
      const synced = provider === 'gocardless' ? await syncGoCardless(stored, env)
        : provider === 'paypal' ? await syncPayPal(stored, env)
          : (() => { throw new Error('finAPI adapter is not configured.') })()
      const lastSyncAt = new Date().toISOString()
      await store.set(user, provider, { ...synced.credential, consentId: stored.consentId, redirectUri: stored.redirectUri, lastSyncAt, consentExpiresAt: synced.consentExpiresAt })
      results.push({ connection: { ...connection(provider, stored), lastSyncAt }, accounts: synced.accounts, transactions: synced.transactions, reconciliation: synced.reconciliation })
    } catch (error) {
      results.push({ connection: connection(provider, stored, error instanceof Error ? error.message : 'Synchronization failed.'), accounts: [], transactions: [] })
    }
  }
  return { connections: results, synchronizedAt: new Date().toISOString() }
}

function syncIdempotencyKey(request, user) {
  const key = String(request.headers['idempotency-key'] || '').trim()
  if (!key) return null
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new HttpError(400, 'invalid_idempotency_key', 'Invalid Idempotency-Key header.')
  return `${user}:${key}`
}

function pruneSyncReplayCache(now = Date.now()) {
  for (const [key, entry] of syncReplayCache) if (entry.expiresAt <= now) syncReplayCache.delete(key)
}

async function sync(request, response) {
  const user = userId(request)
  const replayKey = syncIdempotencyKey(request, user)
  pruneSyncReplayCache()
  if (replayKey) {
    const cached = syncReplayCache.get(replayKey)
    if (cached) return send(response, 200, cached.payload, { 'Idempotency-Replayed': 'true' })
  }

  let operation = activeSyncs.get(user)
  const joined = Boolean(operation)
  if (!operation) {
    operation = buildSyncPayload(user)
    activeSyncs.set(user, operation)
  }
  try {
    const payload = await operation
    if (replayKey) syncReplayCache.set(replayKey, { payload, expiresAt: Date.now() + SYNC_REPLAY_TTL_MS })
    return send(response, 200, payload, joined ? { 'Idempotency-Replayed': 'true' } : {})
  } finally {
    if (activeSyncs.get(user) === operation) activeSyncs.delete(user)
  }
}

async function handleWebhook(provider, request, response) {
  const secret = env[`${provider.toUpperCase()}_WEBHOOK_SECRET`]
  const result = await processWebhook({
    request,
    provider,
    secret,
    store,
    handler: async ({ eventId, occurredAt, payload }) => {
      console.log(JSON.stringify({ level: 'info', event: 'bank_webhook_verified', provider, eventId, occurredAt, eventType: payload?.event_type || payload?.type || payload?.action || 'unknown' }))
    },
  })
  return send(response, result.duplicate ? 200 : 202, result, { 'Idempotency-Replayed': String(result.duplicate) })
}

const handleAuth = await createAuthRouter({ env, origin, sessionSecret, send })
const handleFinance = createFinanceRouter({ env, send, body, userId })
const handleAi = createAiRouter({ env, send, body, userId })

const server = createServer(async (request, response) => {
  const startedAt = Date.now()
  const id = requestId(request.headers)
  response.setHeader('X-Request-ID', id)
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (shuttingDown && url.pathname !== '/health/live') return send(response, 503, { error: { code: 'shutting_down', message: 'Service is shutting down.' }, requestId: id })
    if (!cors(request, response)) return send(response, 403, { error: { code: 'origin_forbidden', message: 'Origin not allowed.' }, requestId: id })
    if (!await rateLimit(request, response, url.pathname)) return
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID, Idempotency-Key', 'Access-Control-Max-Age': '600' })
      return response.end()
    }
    if (request.method === 'GET' && url.pathname === '/health/live') return send(response, 200, { status: 'ok', service: 'finance-planner-connector' })
    if (request.method === 'GET' && url.pathname === '/health/bank') {
      const capabilities = bankCapabilities()
      return send(response, capabilities.ready ? 200 : 503, capabilities)
    }
    if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/ready')) {
      const capabilities = bankCapabilities()
      const serviceReady = ready && (!capabilities.production || capabilities.ready)
      return send(response, serviceReady ? 200 : 503, { status: serviceReady ? 'ready' : 'not_ready', service: 'finance-planner-connector', version: '0.1.0', persistence: persistence.driver, distributedRateLimiting: Boolean(distributedLimiters?.distributed), bank: capabilities })
    }
    const webhook = url.pathname.match(/^\/api\/connectors\/webhooks\/(gocardless|finapi|paypal)$/)
    if (request.method === 'POST' && webhook) return await handleWebhook(webhook[1], request, response)
    if (await handleAuth(request, response, url)) return
    if (await handleFinance(request, response, url)) return
    if (await handleAi(request, response, url)) return
    if (request.method === 'POST' && url.pathname === '/api/session/local') {
      if (env.AUTH_MODE !== 'local') return send(response, 404, { error: { code: 'not_found', message: 'Not found.' }, requestId: id })
      const token = createSession('local-user', sessionSecret, 86400)
      return send(response, 200, { authenticated: true }, { 'Set-Cookie': `fp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${origin.startsWith('https://') ? '; Secure' : ''}` })
    }
    const match = url.pathname.match(/^\/api\/connectors\/(gocardless|finapi|paypal)\/start$/)
    if (request.method === 'POST' && match) return await start(match[1], request, response)
    if (request.method === 'POST' && url.pathname === '/api/connectors/sync') return await sync(request, response)
    const disconnect = url.pathname.match(/^\/api\/connectors\/(gocardless|finapi|paypal)$/)
    if (request.method === 'DELETE' && disconnect) {
      const user = userId(request)
      await store.remove(user, disconnect[1])
      return send(response, 200, { disconnected: true })
    }
    if (request.method === 'GET' && url.pathname === '/api/connectors/callback') {
      const provider = String(url.searchParams.get('provider') || '')
      if (!['gocardless', 'finapi', 'paypal'].includes(provider)) throw new HttpError(400, 'unknown_provider', 'Unknown connector provider.')
      const state = verifyState(url.searchParams.get('state'), provider, sessionSecret)
      if (!state.consentId || !state.redirectUri) throw new HttpError(400, 'invalid_state', 'Consent state is incomplete.')
      const activated = await store.activateConnection({ nonce: state.nonce, consentId: state.consentId, userId: state.sub, provider, redirectUri: state.redirectUri, now: Date.now(), connectedAt: new Date().toISOString() })
      if (!activated) throw new HttpError(400, 'invalid_state', 'Consent state was already used, expired, or does not match.')
      response.writeHead(302, { Location: state.redirectUri, 'Cache-Control': 'no-store', 'X-Request-ID': id })
      return response.end()
    }
    send(response, 404, { error: { code: 'not_found', message: 'Not found.' }, requestId: id })
  } catch (error) {
    const failure = classifyError(error)
    if (failure.status >= 500) console.error(JSON.stringify({ level: 'error', requestId: id, error: error instanceof Error ? error.stack : String(error) }))
    send(response, failure.status, { error: { code: failure.code, message: failure.message }, requestId: id })
  } finally {
    console.log(JSON.stringify({ level: 'info', requestId: id, method: request.method, path: request.url, status: response.statusCode, durationMs: Date.now() - startedAt }))
  }
})

server.requestTimeout = Number(env.REQUEST_TIMEOUT_MS || 15_000)
server.headersTimeout = Number(env.HEADERS_TIMEOUT_MS || 10_000)
server.keepAliveTimeout = Number(env.KEEP_ALIVE_TIMEOUT_MS || 5_000)
server.maxRequestsPerSocket = Number(env.MAX_REQUESTS_PER_SOCKET || 1000)

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  ready = false
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }))
  const force = setTimeout(() => process.exit(1), Number(env.SHUTDOWN_TIMEOUT_MS || 10_000)).unref()
  server.close(async (error) => {
    try {
      if (error) throw error
      await persistence.close()
      clearTimeout(force)
      console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete' }))
      process.exit(0)
    } catch (shutdownError) {
      console.error(JSON.stringify({ level: 'error', event: 'shutdown_failed', error: shutdownError.message }))
      process.exit(1)
    }
  })
  server.closeIdleConnections?.()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', (error) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'uncaught_exception', error: error.stack || error.message }))
  shutdown('uncaughtException')
})
process.on('unhandledRejection', (error) => {
  console.error(JSON.stringify({ level: 'fatal', event: 'unhandled_rejection', error: error instanceof Error ? error.stack : String(error) }))
  shutdown('unhandledRejection')
})

server.listen(port, host, () => console.log(JSON.stringify({ level: 'info', event: 'server_listening', host, port, persistence: persistence.driver, distributedRateLimiting: Boolean(distributedLimiters?.distributed), bank: bankCapabilities() })))
