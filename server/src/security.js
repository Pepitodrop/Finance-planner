import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function safeSignatureEqual(actual, expected) {
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export function createSession(userId, secret, ttlSeconds = 3600) {
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: issuedAt, exp: issuedAt + ttlSeconds })).toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

export function verifySessionClaims(token, secret) {
  const [payload, signature] = String(token ?? '').split('.')
  if (!payload || !signature) throw new Error('Authentication required.')
  const expected = sign(payload, secret)
  if (!safeSignatureEqual(signature, expected)) throw new Error('Invalid session.')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  const now = Math.floor(Date.now() / 1000)
  if (!decoded.sub || decoded.exp < now) throw new Error('Session expired.')
  const issuedAt = Number(decoded.iat || 0)
  if (!Number.isSafeInteger(issuedAt) || issuedAt < 0 || issuedAt > now + 60) throw new Error('Invalid session.')
  return { sub: String(decoded.sub), iat: issuedAt, exp: Number(decoded.exp) }
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

export function verifyState(value, expectedProvider, secret) {
  const [payload, signature] = String(value ?? '').split('.')
  if (!payload || !signature) throw new Error('Invalid consent state.')
  const expected = sign(payload, secret)
  if (!safeSignatureEqual(signature, expected)) throw new Error('Invalid consent state.')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (decoded.provider !== expectedProvider || decoded.exp < Math.floor(Date.now() / 1000)) throw new Error('Expired consent state.')
  if (!decoded.sub || !decoded.nonce) throw new Error('Invalid consent state.')
  return decoded
}
