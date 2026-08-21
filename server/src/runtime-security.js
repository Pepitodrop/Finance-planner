import { randomUUID } from 'node:crypto'

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function requestId(headers = {}) {
  const supplied = String(headers['x-request-id'] || '')
  return /^[A-Za-z0-9._-]{8,128}$/.test(supplied) ? supplied : randomUUID()
}

// Checked BEFORE the generic /api/connectors/ sensitive-prefix match below --
// a decorative image fetch (the institution-logo proxy) is not a
// security-sensitive banking operation and must never share the sensitive
// rate-limit bucket with POST /start, sync or disconnect (found live
// 2026-08-21: a real bank directory's logo requests alone exhausted the
// sensitive bucket and starved /start for the same client). Matches the
// exact route shape server.js's own logo handler does. The negative
// lookahead excludes `webhooks` as the provider segment: without it,
// `/api/connectors/webhooks/logo` would also match (colliding with the
// webhook dispatch route's own `/api/connectors/webhooks/:provider`
// pattern) and get classified into the permissive asset tier. That path is
// inert today (no provider is ever named "logo", so it 404s before any
// rate-limit-relevant work happens) but excluding it keeps the two route
// families from overlapping at all rather than relying on that coincidence.
const LOGO_ROUTE_PATTERN = /^\/api\/connectors\/(?!webhooks\/)[a-z0-9][a-z0-9-]{1,39}\/logo$/

export function rateLimitTier(pathname) {
  if (LOGO_ROUTE_PATTERN.test(pathname)) return 'asset'
  if (/^\/api\/(auth|session|connectors|subscriptions|finance|ai)/.test(pathname)) return 'sensitive'
  return 'general'
}

export function clientIp(request) {
  // Prefer X-Real-IP: nginx always overwrites it with $remote_addr, so a
  // client cannot forge it. X-Forwarded-For is nginx-appended but not
  // nginx-sanitized -- a client can prepend an arbitrary value and have it
  // picked up if we naively took the first comma-separated entry.
  const realIp = String(request.headers['x-real-ip'] || '').trim()
  if (realIp) return realIp
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return forwarded || request.socket?.remoteAddress || 'unknown'
}

export class SlidingWindowRateLimiter {
  constructor({ limit = 120, windowMs = 60_000, maxEntries = 10_000 } = {}) {
    this.limit = limit
    this.windowMs = windowMs
    this.maxEntries = maxEntries
    this.entries = new Map()
  }

  consume(key, now = Date.now()) {
    let entry = this.entries.get(key)
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + this.windowMs }
    entry.count += 1
    this.entries.set(key, entry)
    if (this.entries.size > this.maxEntries) this.prune(now)
    return {
      allowed: entry.count <= this.limit,
      remaining: Math.max(0, this.limit - entry.count),
      resetAt: entry.resetAt,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    }
  }

  prune(now = Date.now()) {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key)
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value)
  }
}

export function classifyError(error) {
  if (error instanceof HttpError) return { status: error.status, code: error.code, message: error.message }
  const message = error instanceof Error ? error.message : 'Unexpected server error.'
  if (/Invalid email or password/i.test(message)) return { status: 401, code: 'invalid_credentials', message: 'Invalid email or password.' }
  if (/account with this email address already exists/i.test(message)) return { status: 409, code: 'account_exists', message }
  if (/Enter a valid email address|Password must contain between 12 and 200 characters|Name must contain at most 100 characters/i.test(message)) return { status: 400, code: 'invalid_credentials_input', message }
  if (/Authentication required|Invalid session|Session expired|Session revoked/i.test(message)) return { status: 401, code: 'unauthorized', message: 'Authentication required.' }
  if (/Request body too large/i.test(message)) return { status: 413, code: 'payload_too_large', message }
  if (/Content-Type must be application\/json/i.test(message)) return { status: 415, code: 'unsupported_media_type', message }
  if (/Unexpected end|JSON|body/i.test(message)) return { status: 400, code: 'invalid_request', message: 'Invalid JSON request body.' }
  return { status: 500, code: 'internal_error', message: 'Internal server error.' }
}

export function validateProductionConfig(env, origin) {
  if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'local') {
    throw new Error('AUTH_MODE=local is not allowed when NODE_ENV=production. It mints unauthenticated sessions via POST /api/session/local.')
  }
  if (env.NODE_ENV !== 'production' || env.PUBLIC_DEPLOYMENT !== 'true') return
  if (!origin.startsWith('https://')) throw new Error('APP_ORIGIN must use HTTPS for public production deployments.')
  if (String(env.CONNECTOR_STORE_DRIVER || '').toLowerCase() !== 'postgres') throw new Error('Public production deployments require CONNECTOR_STORE_DRIVER=postgres.')
  if (env.TRUST_PROXY !== 'true') throw new Error('Public production deployments require TRUST_PROXY=true behind the bundled reverse proxy.')
  if (String(env.METRICS_TOKEN || '').length < 32) throw new Error('Public production deployments require a METRICS_TOKEN with at least 32 characters.')
}
