import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import { deleteAccountData } from './account-deletion.js'
import { createAiRouter } from './ai-router.js'
import { createAuthRouter } from './auth-router.js'
import { behaviorEventsFromFinanceState } from './budget-learning.js'
import { BudgetProfileStore } from './budget-profile-store.js'
import { createBudgetRouter } from './budget-router.js'
import { createConnectorStore } from './database.js'
import { createRateLimiters } from './distributed-rate-limiter.js'
import { createFinanceRouter } from './finance-router.js'
import { createGoogleSubscriptionsRouter } from './google-subscriptions-router.js'
import { OperationalMetrics } from './operational-metrics.js'
import { authorizeProviderUser, describeProviderForUser } from './provider-access.js'
import { createOpenBankingProviderRegistry } from './providers.js'
import { HttpError, SlidingWindowRateLimiter, classifyError, clientIp, requestId, validateProductionConfig } from './runtime-security.js'
import { bearerToken, createSession, issueState, verifySessionClaims, verifyState } from './security.js'
import { SessionRevocationRegistry } from './session-revocation.js'
import { PostgresUserStateStore } from './user-state-store.js'
import { bankProductionCapabilities, processWebhook } from './webhook-security.js'

const env = process.env
const port = Number(env.PORT || 8787)
const host = env.HOST || '127.0.0.1'
const origin = env.APP_ORIGIN || 'http://localhost:5173'
const sessionSecret = env.SESSION_SECRET || ''
const releaseVersion = env.RELEASE_VERSION || '0.2.0'
const releaseCommit = env.RELEASE_SHA || env.GIT_COMMIT || 'unknown'
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
if (!['127.0.0.1', '0.0.0.0', '::'].includes(host)) throw new Error('HOST must be 127.0.0.1, 0.0.0.0, or ::.')
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')
validateProductionConfig(env, origin)

const persistence = await createConnectorStore(env)
const store = persistence.store
const userStateStore = persistence.pool ? new PostgresUserStateStore(persistence.pool, env.CONNECTOR_MASTER_KEY || '') : null
const budgetProfileStore = persistence.pool ? new BudgetProfileStore(persistence.pool, env.CONNECTOR_MASTER_KEY || '') : null
const sessionRevocations = new SessionRevocationRegistry({
  pool: persistence.pool,
  secret: sessionSecret,
  refreshMs: Number(env.SESSION_REVOCATION_REFRESH_MS || 30_000),
})
await sessionRevocations.load()
sessionRevocations.start()
const metrics = new OperationalMetrics({ version: releaseVersion, commit: releaseCommit })
const providerRegistry = createOpenBankingProviderRegistry(env)
const bankCapabilities = () => bankProductionCapabilities(env, persistence, providerRegistry)
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

// Fixed, application-owned copy for callback-route failures -- never reflect
// a caller-supplied error/error_description into the redirect; only ever a
// pre-approved code mapped to pre-approved text.
const CALLBACK_ERROR_COPY = Object.freeze({
  invalid_state: 'This connection could not be completed. It may have expired or already been used.',
  access_denied: 'This connection could not be completed. The provider reported that authorization was not granted.',
})

function securityHeaders(contentType = 'application/json; charset=utf-8') {
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-site',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  }
  if (origin.startsWith('https://')) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
  return headers
}

function send(response, status, payload, headers = {}) {
  const aiSource = payload?.source || payload?.ai?.source
  if (typeof aiSource === 'string') response.financePlannerAiSource = aiSource
  response.writeHead(status, { ...securityHeaders(), ...headers })
  response.end(JSON.stringify(payload))
}

function metricsAuthorized(request) {
  const configured = String(env.METRICS_TOKEN || '')
  if (!configured) return env.NODE_ENV !== 'production' || env.PUBLIC_DEPLOYMENT !== 'true'
  const supplied = bearerToken(request)
  const actual = Buffer.from(supplied)
  const expected = Buffer.from(configured)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function sendMetrics(request, response) {
  if (!metricsAuthorized(request)) return send(response, 401, { error: { code: 'metrics_unauthorized', message: 'Metrics authentication required.' } })
  response.writeHead(200, securityHeaders('text/plain; version=0.0.4; charset=utf-8'))
  response.end(metrics.prometheus())
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

function verifyActiveSession(token) {
  return sessionRevocations.verify(verifySessionClaims(token, sessionSecret))
}

function userId(request) {
  const token = cookies(request).fp_session
  if (!token) throw new Error('Authentication required.')
  return verifyActiveSession(token)
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
  const sensitive = /^\/api\/(auth|session|connectors|subscriptions|finance|ai)/.test(pathname)
  const limiter = sensitive ? sensitiveLimiter : generalLimiter
  const result = await limiter.consume(`${remote}:${sensitive ? 'sensitive' : 'general'}`)
  response.setHeader('RateLimit-Limit', limiter.limit)
  response.setHeader('RateLimit-Remaining', result.remaining)
  response.setHeader('RateLimit-Reset', Math.ceil(result.resetAt / 1000))
  if (result.allowed) return true
  send(response, 429, { error: { code: 'rate_limited', message: 'Too many requests.' }, requestId: response.getHeader('X-Request-ID') }, { 'Retry-After': result.retryAfter })
  return false
}

function providerAdapter(provider) {
  try {
    return providerRegistry.get(provider)
  } catch {
    throw new HttpError(404, 'unknown_provider', 'Unknown connector provider.')
  }
}

function connection(provider, stored, error) {
  const description = providerAdapter(provider).describe()
  return {
    id: provider,
    provider,
    displayName: description.displayName,
    status: error ? 'error' : stored ? 'connected' : 'disconnected',
    lastSyncAt: stored?.lastSyncAt,
    consentExpiresAt: stored?.consentExpiresAt,
    // Not a secret -- the same institution id the picker already fetches
    // from the live directory. Exposed so Reconnect can resubmit the
    // originally-selected institution instead of an empty context, which
    // start() now correctly rejects with institution_required.
    institutionId: stored?.institutionId,
    error,
  }
}

async function start(provider, request, response) {
  const user = userId(request)
  const adapter = providerAdapter(provider)
  const description = authorizeProviderUser(adapter, user, env)
  if (!description.available) throw new HttpError(501, 'provider_unavailable', description.reason || 'Provider adapter is unavailable.')
  if (!description.configured) throw new HttpError(503, 'provider_not_configured', `${description.displayName} is not configured.`)
  const input = await body(request)
  const redirect = new URL(String(input.redirectUri || origin))
  if (redirect.origin !== origin) throw new HttpError(400, 'invalid_redirect', 'Invalid redirect origin.')
  const institutionId = typeof input.institutionId === 'string' && input.institutionId.trim() ? input.institutionId.trim().slice(0, 128) : undefined
  // Same validation the sibling /institutions listing route already applies
  // -- unvalidated here would let an attacker grow GoCardlessProvider's
  // in-memory, TTL-only institutionsCache with unbounded distinct keys.
  const country = String(input.country || 'DE').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'invalid_country', 'Invalid country code.')
  const consentId = randomUUID()
  const state = issueState(user, provider, sessionSecret, { consentId, redirectUri: redirect.toString() })
  const claims = verifyState(state, provider, sessionSecret)
  const result = await adapter.start({ state, redirectUri: redirect.toString(), country, institutionId })
  // Pending, not yet live -- a currently-working connection for this
  // provider (reconnect case) must not be overwritten until the callback
  // actually verifies. See activateConnection().
  await store.createPendingConnectionSetup({
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
  for (const { id: provider } of providerRegistry.list()) {
    const stored = await store.get(user, provider)
    if (!stored) continue
    try {
      const adapter = providerAdapter(provider)
      authorizeProviderUser(adapter, user, env)
      const synced = await adapter.sync(stored)
      const lastSyncAt = new Date().toISOString()
      await store.set(user, provider, { ...synced.credential, consentId: stored.consentId, redirectUri: stored.redirectUri, lastSyncAt, consentExpiresAt: synced.consentExpiresAt })
      metrics.recordBank(provider, 'success')
      results.push({ connection: { ...connection(provider, stored), lastSyncAt, consentExpiresAt: synced.consentExpiresAt }, accounts: synced.accounts, transactions: synced.transactions, reconciliation: synced.reconciliation })
    } catch (error) {
      metrics.recordBank(provider, /consent.*expired/i.test(String(error?.message || error)) ? 'expired' : 'failure')
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
  const adapter = providerAdapter(provider)
  const description = adapter.describe()
  if (!description.webhookRequired && !env[`${provider.toUpperCase().replaceAll('-', '_')}_WEBHOOK_SECRET`]) {
    throw new HttpError(404, 'webhook_unavailable', 'This provider does not use webhook delivery.')
  }
  const secret = env[`${provider.toUpperCase().replaceAll('-', '_')}_WEBHOOK_SECRET`]
  const result = await processWebhook({
    request,
    provider,
    secret,
    store,
    handler: async ({ eventId, occurredAt, payload }) => {
      console.log(JSON.stringify({ level: 'info', event: 'bank_webhook_verified', provider, eventId, occurredAt, eventType: payload?.event_type || payload?.type || payload?.action || 'unknown' }))
    },
  })
  metrics.recordBank(provider, 'success')
  return send(response, result.duplicate ? 200 : 202, result, { 'Idempotency-Replayed': String(result.duplicate) })
}

async function loadBehaviorEvents(user) {
  if (!userStateStore) throw new HttpError(503, 'behavior_history_unavailable', 'Trusted server-side financial history requires PostgreSQL cloud state.')
  const cloud = await userStateStore.get(user)
  return cloud.payload ? behaviorEventsFromFinanceState(cloud.payload.state) : []
}

const handleAuth = await createAuthRouter({
  env,
  origin,
  sessionSecret,
  send,
  verifyActiveSession,
  deleteUserData: (user) => deleteAccountData({ userId: user, persistence, store, sessionRevocations }),
  revokeSession: (user) => sessionRevocations.revoke(user),
})
const handleFinance = createFinanceRouter({ env, send, body, userId })
const handleBudget = createBudgetRouter({ env, send, body, userId, stateStore: userStateStore, profileStore: budgetProfileStore })
const handleAi = createAiRouter({ env, send, body, userId, loadBehaviorEvents })
const handleGoogleSubscriptions = createGoogleSubscriptionsRouter({ env, origin, sessionSecret, store, send, body, userId })

const server = createServer(async (request, response) => {
  const startedAt = Date.now()
  const id = requestId(request.headers)
  let pathname = 'unknown'
  response.setHeader('X-Request-ID', id)
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    pathname = url.pathname
    if (shuttingDown && url.pathname !== '/health/live') return send(response, 503, { error: { code: 'shutting_down', message: 'Service is shutting down.' }, requestId: id })
    if (!cors(request, response)) return send(response, 403, { error: { code: 'origin_forbidden', message: 'Origin not allowed.' }, requestId: id })
    if (request.method === 'GET' && url.pathname === '/metrics') return sendMetrics(request, response)
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
      const serviceReady = ready
      return send(response, serviceReady ? 200 : 503, {
        status: serviceReady ? 'ready' : 'not_ready',
        service: 'finance-planner-connector',
        version: releaseVersion,
        commit: releaseCommit,
        persistence: persistence.driver,
        distributedRateLimiting: Boolean(distributedLimiters?.distributed),
        sessionRevocation: persistence.pool ? 'postgres-refresh-cache' : 'process-local',
        observability: { prometheusMetrics: true, authenticated: Boolean(env.METRICS_TOKEN) },
        bank: capabilities,
      })
    }
    const webhook = url.pathname.match(/^\/api\/connectors\/webhooks\/([a-z0-9][a-z0-9-]{1,39})$/)
    if (request.method === 'POST' && webhook) return await handleWebhook(webhook[1], request, response)
    if (await handleGoogleSubscriptions(request, response, url)) return
    if (await handleAuth(request, response, url)) return
    if (await handleFinance(request, response, url)) return
    if (await handleBudget(request, response, url)) return
    if (await handleAi(request, response, url)) return
    if (request.method === 'POST' && url.pathname === '/api/session/local') {
      if (env.AUTH_MODE !== 'local') return send(response, 404, { error: { code: 'not_found', message: 'Not found.' }, requestId: id })
      const token = createSession('local-user', sessionSecret, 86400)
      return send(response, 200, { authenticated: true }, { 'Set-Cookie': `fp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${origin.startsWith('https://') ? '; Secure' : ''}` })
    }
    if (request.method === 'GET' && url.pathname === '/api/connectors') {
      const user = userId(request)
      const providers = providerRegistry.adapters().map((adapter) => describeProviderForUser(adapter, user, env))
      return send(response, 200, { providers })
    }
    const institutionsMatch = url.pathname.match(/^\/api\/connectors\/([a-z0-9][a-z0-9-]{1,39})\/institutions$/)
    if (request.method === 'GET' && institutionsMatch) {
      const user = userId(request)
      const adapter = providerAdapter(institutionsMatch[1])
      // Same owner-mode gate as /start and the /api/connectors listing --
      // no adapter today implements institutionDirectory() AND owner-mode
      // gating simultaneously, but this route must not become the one place
      // that forgets to check, if one ever does.
      authorizeProviderUser(adapter, user, env)
      const country = String(url.searchParams.get('country') || 'DE').toUpperCase()
      if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'invalid_country', 'Invalid country code.')
      const institutions = await adapter.institutionDirectory(country)
      return send(response, 200, { institutions })
    }
    const match = url.pathname.match(/^\/api\/connectors\/([a-z0-9][a-z0-9-]{1,39})\/start$/)
    if (request.method === 'POST' && match) return await start(match[1], request, response)
    if (request.method === 'POST' && url.pathname === '/api/connectors/sync') return await sync(request, response)
    const disconnect = url.pathname.match(/^\/api\/connectors\/([a-z0-9][a-z0-9-]{1,39})$/)
    if (request.method === 'DELETE' && disconnect) {
      const user = userId(request)
      const adapter = providerAdapter(disconnect[1])
      const stored = await store.get(user, disconnect[1])
      // Best-effort: ask the provider to end its side of the consent before
      // dropping our own record. A failed/unsupported revoke must never
      // block the user's local disconnect, and must never be reported as
      // confirmed when the provider didn't actually confirm it.
      let providerRevoked = false
      let providerRevokeReason = 'not_applicable'
      if (stored) {
        try {
          const outcome = await adapter.disconnect(stored)
          providerRevoked = Boolean(outcome?.revoked)
          providerRevokeReason = providerRevoked ? 'confirmed' : (outcome?.reason || 'provider_error')
        } catch {
          providerRevokeReason = 'provider_error'
        }
      }
      await store.remove(user, disconnect[1])
      metrics.recordBank(disconnect[1], 'disconnected')
      return send(response, 200, { disconnected: true, providerRevoked, providerRevokeReason })
    }
    if (request.method === 'GET' && url.pathname === '/api/connectors/callback') {
      // A real provider return (or a forged/expired/replayed/malformed hit on
      // this URL) must never dead-end in raw JSON -- the user is mid-flow in
      // their browser, not calling an API client. Every failure here redirects
      // back into the app with a fixed, safe error code/description (never a
      // caller-supplied string) so ConnectionsPage's existing error handling
      // can show it. Redirect to state.redirectUri when it's known and
      // cryptographically verified (state parsed successfully); otherwise fall
      // back to the app origin.
      const provider = String(url.searchParams.get('provider') || '')
      const redirectWithError = (target, errorCode = 'invalid_state') => {
        const location = new URL(target)
        location.searchParams.set('error', errorCode)
        location.searchParams.set('error_description', CALLBACK_ERROR_COPY[errorCode] || CALLBACK_ERROR_COPY.invalid_state)
        response.writeHead(302, { Location: location.toString(), 'Cache-Control': 'no-store', 'X-Request-ID': id })
        response.end()
      }
      let state
      try {
        providerAdapter(provider)
        state = verifyState(url.searchParams.get('state'), provider, sessionSecret)
      } catch {
        redirectWithError(origin)
        return
      }
      if (!state.consentId || !state.redirectUri) {
        redirectWithError(origin)
        return
      }
      // Two provider-agnostic steps, never one -- see providers.js's
      // completeCallback() doc comment and the postgres-store.js/
      // crypto-store.js consumePendingConnectionSetup()/finalizeConnection()
      // doc comments for the full reasoning. The nonce is consumed first
      // (single local operation, still atomic and replay-proof); only once
      // that succeeds AND the provider's own completion step succeeds does
      // the connection get promoted into the live connector_connections
      // record. No provider-specific branching lives here -- every provider
      // implements the same completeCallback() contract (a pass-through for
      // GoCardless/PayPal, a real code-for-session exchange for Enable
      // Banking).
      let pending
      try {
        pending = await store.consumePendingConnectionSetup({ nonce: state.nonce, consentId: state.consentId, userId: state.sub, provider, redirectUri: state.redirectUri, now: Date.now() })
      } catch {
        redirectWithError(state.redirectUri)
        return
      }
      if (!pending) {
        redirectWithError(state.redirectUri)
        return
      }
      let completed
      try {
        completed = await providerAdapter(provider).completeCallback({ code: url.searchParams.get('code'), pending })
      } catch (error) {
        // The nonce is already burned and any existing working connection
        // (reconnect case) is untouched -- this connection attempt simply
        // never gets finalized. Distinguish "the user declined at the
        // provider" (authorization_denied, an honest and distinct message)
        // from every other failure (network error, malformed response,
        // rejected code -- the generic copy), but never reflect the raw
        // provider/error text itself.
        redirectWithError(state.redirectUri, error?.code === 'authorization_denied' ? 'access_denied' : 'invalid_state')
        return
      }
      try {
        await store.finalizeConnection({ userId: state.sub, provider, connection: completed, connectedAt: new Date().toISOString() })
      } catch {
        redirectWithError(state.redirectUri)
        return
      }
      const success = new URL(state.redirectUri)
      success.searchParams.set('provider', provider)
      response.writeHead(302, { Location: success.toString(), 'Cache-Control': 'no-store', 'X-Request-ID': id })
      return response.end()
    }
    send(response, 404, { error: { code: 'not_found', message: 'Not found.' }, requestId: id })
  } catch (error) {
    const failure = classifyError(error)
    if (failure.status >= 500) console.error(JSON.stringify({ level: 'error', requestId: id, error: error instanceof Error ? error.stack : String(error) }))
    send(response, failure.status, { error: { code: failure.code, message: failure.message }, requestId: id })
  } finally {
    const durationMs = Date.now() - startedAt
    metrics.recordHttp({ method: request.method, pathname, status: response.statusCode, durationMs })
    if (response.financePlannerAiSource) metrics.recordAi(pathname, response.financePlannerAiSource)
    if (request.method === 'DELETE' && pathname === '/api/auth/account') metrics.recordAccountDeletion(response.statusCode < 300 ? 'success' : 'failure')
    console.log(JSON.stringify({ level: 'info', requestId: id, method: request.method, path: pathname, status: response.statusCode, durationMs }))
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
      sessionRevocations.close()
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

server.listen(port, host, () => console.log(JSON.stringify({
  level: 'info',
  event: 'server_listening',
  host,
  port,
  version: releaseVersion,
  commit: releaseCommit,
  persistence: persistence.driver,
  distributedRateLimiting: Boolean(distributedLimiters?.distributed),
  bank: bankCapabilities(),
})))
