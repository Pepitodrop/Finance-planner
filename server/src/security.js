import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function safeSignatureEqual(actual, expected) {
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export function createSession(userId, secret, ttlSeconds = 3600) {
  const issuedAtMs = Date.now()
  const issuedAt = Math.floor(issuedAtMs / 1000)
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: issuedAt, iatMs: issuedAtMs, exp: issuedAt + ttlSeconds })).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function verifySessionClaims(token, secret) {
  const [payload, signature] = String(token ?? '').split('.')
  if (!payload || !signature) throw new Error('Authentication required.')
  const expected = sign(payload, secret)
  if (!safeSignatureEqual(signature, expected)) throw new Error('Invalid session.')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  const nowMs = Date.now()
  const now = Math.floor(nowMs / 1000)
  if (!decoded.sub || decoded.exp < now) throw new Error('Session expired.')
  const issuedAt = Number(decoded.iat || 0)
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || issuedAt > now + 60) throw new Error('Invalid session.')

  let issuedAtMs = issuedAt * 1000
  if (decoded.iatMs !== undefined) {
    issuedAtMs = Number(decoded.iatMs)
    if (!Number.isSafeInteger(issuedAtMs)
      || issuedAtMs < 0
      || Math.floor(issuedAtMs / 1000) !== issuedAt
      || issuedAtMs > nowMs + 60_000) {
      throw new Error('Invalid session.')
    }
  }

  return { sub: String(decoded.sub), iat: issuedAt, iatMs: issuedAtMs, exp: Number(decoded.exp) }
}

export function verifySession(token, secret) {
  return verifySessionClaims(token, secret).sub
}

export function bearerToken(request) {
  const header = request.headers.authorization ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

export function issueState(userId, provider, secret, options = {}) {
  const nonce = randomBytes(24).toString('base64url')
  const ttlSeconds = options.ttlSeconds ?? 600
  const claims = {
    sub: userId,
    provider,
    nonce,
    consentId: options.consentId,
    redirectUri: options.redirectUri,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

// Deliberately takes no "expected provider" parameter (removed 2026-08-21,
// see the redirect_uri architecture fix): the provider identity lives
// *inside* the signed payload (`decoded.provider`), so once the signature
// is verified that value is already fully trustworthy on its own -- there
// is nothing left to "expect" it against. This is what lets a callback
// route derive which provider a return belongs to directly from the
// verified state itself, rather than from a separate, unauthenticated
// query parameter the URL may or may not still carry (Enable Banking's own
// redirect does not; GoCardless/PayPal's still does, but it's now
// redundant rather than load-bearing). A caller that still wants a strict
// "this state must belong to provider X" check performs it itself against
// the returned `.provider` field -- see server.js's start() self-check and
// google-subscriptions-router.js for examples.
export function verifyState(value, secret) {
  const [payload, signature] = String(value ?? '').split('.')
  if (!payload || !signature) throw new Error('Invalid consent state.')
  const expected = sign(payload, secret)
  if (!safeSignatureEqual(signature, expected)) throw new Error('Invalid consent state.')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (!decoded.provider || decoded.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired consent state.')
  if (!decoded.sub || !decoded.nonce) throw new Error('Invalid consent state.')
  return decoded
}
