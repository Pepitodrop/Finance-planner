import { createHash, randomBytes } from 'node:crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { AuthStore } from './auth-store.js'
import { createDatabase, migrateDatabase } from './database.js'
import { createSession } from './security.js'

const b64 = (value) => Buffer.from(value).toString('base64url')
const tokenHash = (token) => createHash('sha256').update(String(token), 'utf8').digest('hex')
const enrollmentKey = (token) => `test-enrollment:${tokenHash(token)}`

function cookie(value, origin, maxAge = 30 * 24 * 60 * 60) {
  return `fp_session=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${origin.startsWith('https://') ? '; Secure' : ''}`
}

async function jsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 256_000) throw new Error('Request body too large.')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

export async function createEnrollmentStore(env = process.env) {
  const pool = createDatabase(env.DATABASE_URL)
  await migrateDatabase(pool)
  const store = new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )
  await store.load()
  return { pool, store }
}

export async function createTestEnrollment({ env = process.env, email, name = 'Finance Planner Test', ttlMinutes = 15 }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid test-account email is required.')
  const normalizedEmail = email.toLowerCase()
  const { pool, store } = await createEnrollmentStore(env)
  try {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + Math.max(5, Math.min(60, Number(ttlMinutes) || 15)) * 60_000
    let user = store.findByEmail(normalizedEmail)
    await store.mutate((data) => {
      user ||= {
        id: `test:${createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 24)}`,
        email: normalizedEmail,
        name,
        passkeys: [],
        createdAt: new Date().toISOString(),
      }
      user.name = name
      user.updatedAt = new Date().toISOString()
      data.users[user.id] = user
      for (const key of Object.keys(data.challenges)) {
        if (key.startsWith('test-enrollment:') && data.challenges[key]?.userId === user.id) delete data.challenges[key]
      }
      data.challenges[enrollmentKey(token)] = { userId: user.id, expiresAt, used: false }
    })
    return { token, userId: user.id, email: normalizedEmail, expiresAt }
  } finally {
    await pool.end()
  }
}

export async function createTestEnrollmentHandler({ env = process.env, origin, sessionSecret, onEnrolled = () => {} }) {
  const rpId = env.WEBAUTHN_RP_ID || new URL(origin).hostname
  const rpName = env.WEBAUTHN_RP_NAME || 'Finance Planner'

  return async function handleTestEnrollment(request, response, url) {
    if (!url.pathname.startsWith('/api/auth/test-enrollment/')) return false
    const send = (status, payload, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
      response.end(JSON.stringify(payload))
    }

    const { pool, store } = await createEnrollmentStore(env)
    try {
      if (request.method === 'GET' && url.pathname === '/api/auth/test-enrollment/options') {
        const token = String(url.searchParams.get('token') || '')
        const record = store.data.challenges[enrollmentKey(token)]
        const user = record && store.data.users[record.userId]
        if (!token || !record || record.used || record.expiresAt < Date.now() || !user) throw new Error('Enrollment link is invalid or expired.')
        const options = await generateRegistrationOptions({
          rpName,
          rpID: rpId,
          userID: new TextEncoder().encode(user.id),
          userName: user.email,
          attestationType: 'none',
          authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
          excludeCredentials: (user.passkeys || []).map((credential) => ({ id: credential.id, transports: credential.transports })),
        })
        await store.mutate((data) => { data.challenges[enrollmentKey(token)].challenge = options.challenge })
        send(200, options)
        return true
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/test-enrollment/verify') {
        const input = await jsonBody(request)
        const token = String(input.token || '')
        const record = store.data.challenges[enrollmentKey(token)]
        const user = record && store.data.users[record.userId]
        if (!token || !record || record.used || record.expiresAt < Date.now() || !record.challenge || !user) throw new Error('Enrollment link is invalid or expired.')
        const verification = await verifyRegistrationResponse({
          response: input.credential,
          expectedChallenge: record.challenge,
          expectedOrigin: origin,
          expectedRPID: rpId,
          requireUserVerification: true,
        })
        if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey enrollment failed.')
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
        await store.mutate((data) => {
          const target = data.users[user.id]
          target.passkeys ||= []
          target.passkeys.push({ id: credential.id, publicKey: b64(credential.publicKey), counter: credential.counter, transports: credential.transports, deviceType: credentialDeviceType, backedUp: credentialBackedUp })
          delete data.challenges[enrollmentKey(token)]
        })
        const session = createSession(user.id, sessionSecret, 30 * 24 * 60 * 60)
        send(200, { enrolled: true, user: { id: user.id, email: user.email, name: user.name } }, { 'Set-Cookie': cookie(session, origin) })
        await onEnrolled()
        return true
      }

      send(404, { error: 'Not found.' })
      return true
    } finally {
      await pool.end()
    }
  }
}
