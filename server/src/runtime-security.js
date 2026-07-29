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

export function clientIp(request) {
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
  if (/Authentication required|Invalid session|Session expired/i.test(message)) return { status: 401, code: 'unauthorized', message: 'Authentication required.' }
  if (/Request body too large/i.test(message)) return { status: 413, code: 'payload_too_large', message }
  if (/Unexpected end|JSON|body/i.test(message)) return { status: 400, code: 'invalid_request', message: 'Invalid JSON request body.' }
  return { status: 500, code: 'internal_error', message: 'Internal server error.' }
}

export function validateProductionConfig(env, origin) {
  if (env.NODE_ENV === 'production' && env.AUTH_MODE === 'local') {
    throw new Error('AUTH_MODE=local is not allowed when NODE_ENV=production. It mints unauthenticated sessions via POST /api/session/local.')
  }
  if (env.NODE_ENV !== 'production' || env.PUBLIC_DEPLOYMENT !== 'true') return
  if (!origin.startsWith('https://')) throw new Error('APP_ORIGIN must use HTTPS for public production deployments.')
}
