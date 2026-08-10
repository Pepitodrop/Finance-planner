import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { validateAccountDeletionInput } from './account-deletion.js'
import { AuthStore } from './auth-store.js'
import { hashPassword, normalizeDisplayName, normalizeEmail, verifyPassword } from './password-auth.js'
import { createSession, verifySession } from './security.js'
import { verifyTestPassword } from './test-password-auth.js'

const b64 = (value) => Buffer.from(value).toString('base64url')
const unb64 = (value) => new Uint8Array(Buffer.from(value, 'base64url'))
const DEFAULT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const enrollmentKey = (token) => `test-enrollment:${createHash('sha256').update(String(token), 'utf8').digest('hex')}`
// A fixed, valid-format scrypt hash checked (and always discarded) whenever
// there is no real password hash to verify against, so /api/auth/password/login
// always pays the same scrypt cost regardless of whether the email exists.
const DUMMY_PASSWORD_HASH = hashPassword('login-timing-equalization-placeholder-password')

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((entry) => entry.length === 2))
}

function cookie(name, value, origin, maxAge = 600) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${origin.startsWith('https://') ? '; Secure' : ''}`
}

async function jsonBody(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (contentType && contentType !== 'application/json') throw new Error('Content-Type must be application/json.')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 256_000) throw new Error('Request body too large.')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function sessionUser(request, verifyActiveSession) {
  const token = parseCookies(request).fp_session
  return token ? verifyActiveSession(token) : null
}

function configuredSessionTtl(env) {
  const configured = Number(env.SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS)
  if (!Number.isInteger(configured)) return DEFAULT_SESSION_TTL_SECONDS
  return Math.max(3600, Math.min(365 * 24 * 60 * 60, configured))
}

function removeUserFromAuthStore(data, userId) {
  delete data.users[userId]
  for (const key of Object.keys(data.challenges)) {
    if (key.endsWith(`:${userId}`) || data.challenges[key]?.userId === userId) delete data.challenges[key]
  }
}

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    passkeyCount: user.passkeys?.length || 0,
  }
}

export async function createAuthRouter({ env, origin, sessionSecret, send, verifyActiveSession, deleteUserData, revokeSession }) {
  const rpId = env.WEBAUTHN_RP_ID || new URL(origin).hostname
  const rpName = env.WEBAUTHN_RP_NAME || 'Finance Planner'
  const sessionTtlSeconds = configuredSessionTtl(env)
  const verifyToken = verifyActiveSession || ((token) => verifySession(token, sessionSecret))
  const primaryAuthSecret = env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || ''
  const store = new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    primaryAuthSecret,
    undefined,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )
  await store.load()

  if (env.AUTH_MODE === 'local' && !store.data.users['local-user']) {
    await store.mutate((data) => {
      data.users['local-user'] = {
        id: 'local-user',
        email: env.LOCAL_AUTH_EMAIL || 'local@finance-planner.test',
        name: env.LOCAL_AUTH_NAME || 'Local Finance Planner User',
        passkeys: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    })
  }

  const google = new OAuth2Client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, `${origin}/api/auth/google/callback`)

  return async function handleAuth(request, response, url) {
    if (!url.pathname.startsWith('/api/auth/')) return false

    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      let userId = null
      try { userId = sessionUser(request, verifyToken) } catch { userId = null }
      const user = userId ? store.data.users[userId] : null
      const headers = user ? { 'Set-Cookie': cookie('fp_session', createSession(user.id, sessionSecret, sessionTtlSeconds), origin, sessionTtlSeconds) } : {}
      send(response, 200, { authenticated: Boolean(user), user: user ? safeUser(user) : null }, headers)
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (typeof revokeSession === 'function') {
        let userId = null
        try { userId = sessionUser(request, verifyToken) } catch { userId = null }
        if (userId) await revokeSession(userId)
      }
      send(response, 200, { authenticated: false }, { 'Set-Cookie': cookie('fp_session', '', origin, 0) })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/password/register') {
      const input = await jsonBody(request)
      const email = normalizeEmail(input.email)
      const name = normalizeDisplayName(input.name, email)
      const passwordHash = hashPassword(input.password)
      await store.load()
      if (store.findByEmail(email)) throw new Error('An account with this email address already exists.')
      const now = new Date().toISOString()
      const user = { id: `email:${randomUUID()}`, email, name, passwordHash, passkeys: [], createdAt: now, updatedAt: now }
      await store.mutate((data) => { data.users[user.id] = user })
      const session = createSession(user.id, sessionSecret, sessionTtlSeconds)
      send(response, 200, { authenticated: true, user: safeUser(user) }, { 'Set-Cookie': cookie('fp_session', session, origin, sessionTtlSeconds) })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/password/login') {
      const input = await jsonBody(request)
      const email = normalizeEmail(input.email)
      await store.load()
      const user = store.findByEmail(email)
      const configuredTestEmail = String(env.TEST_ACCOUNT_EMAIL || '').trim().toLowerCase()
      const configuredTestHash = String(env.TEST_ACCOUNT_PASSWORD_HASH || '')
      // Always run one scrypt verification, even for an unknown email or a
      // password-less (Google-only) account, so response timing cannot be
      // used to enumerate which emails have a password-based account here.
      const testAccountMatch = Boolean(user) && String(user.id).startsWith('test:') && email === configuredTestEmail
      const hashToVerify = user?.passwordHash || (testAccountMatch ? configuredTestHash : '') || DUMMY_PASSWORD_HASH
      const verifiedAgainstHash = verifyPassword(input.password, hashToVerify)
      const passwordValid = Boolean(user) && hashToVerify !== DUMMY_PASSWORD_HASH && verifiedAgainstHash
      if (!passwordValid) throw new Error('Invalid email or password.')
      const session = createSession(user.id, sessionSecret, sessionTtlSeconds)
      send(response, 200, { authenticated: true, user: safeUser(user) }, { 'Set-Cookie': cookie('fp_session', session, origin, sessionTtlSeconds) })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/test-password/login') {
      const configuredEmail = String(env.TEST_ACCOUNT_EMAIL || '').trim().toLowerCase()
      const configuredHash = String(env.TEST_ACCOUNT_PASSWORD_HASH || '')
      if (!configuredEmail || !configuredHash) throw new Error('Test password login is not configured.')
      const input = await jsonBody(request)
      const submittedEmail = String(input.email || '').trim().toLowerCase()
      const passwordValid = verifyTestPassword(input.password, configuredHash)
      await store.load()
      const user = store.findByEmail(submittedEmail)
      if (!passwordValid || submittedEmail !== configuredEmail || !user || !String(user.id).startsWith('test:')) throw new Error('Invalid email or password.')
      const session = createSession(user.id, sessionSecret, sessionTtlSeconds)
      send(response, 200, { authenticated: true, user: safeUser(user) }, { 'Set-Cookie': cookie('fp_session', session, origin, sessionTtlSeconds) })
      return true
    }

    if (request.method === 'DELETE' && url.pathname === '/api/auth/account') {
      const userId = sessionUser(request, verifyToken)
      if (!userId || !store.data.users[userId]) throw new Error('Authentication required.')
      validateAccountDeletionInput(await jsonBody(request))
      if (typeof deleteUserData !== 'function') throw new Error('Account deletion is unavailable.')
      const deleted = await deleteUserData(userId)
      await store.mutate((data) => removeUserFromAuthStore(data, userId))
      send(response, 200, {
        deleted: true,
        sessionRevokedAt: deleted.revokedBefore,
        recordsDeleted: deleted.deleted,
      }, { 'Set-Cookie': cookie('fp_session', '', origin, 0) })
      return true
    }

    if (url.pathname.startsWith('/api/auth/test-enrollment/')) {
      await store.load()

      if (request.method === 'GET' && url.pathname === '/api/auth/test-enrollment/options') {
        const token = String(url.searchParams.get('token') || '')
        const record = store.data.challenges[enrollmentKey(token)]
        const user = record && store.data.users[record.userId]
        if (!token || !record || record.expiresAt < Date.now() || !user) throw new Error('Enrollment link is invalid or expired.')
        const options = await generateRegistrationOptions({
          rpName,
          rpID: rpId,
          userID: new TextEncoder().encode(user.id),
          userName: user.email,
          attestationType: 'none',
          authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
          excludeCredentials: (user.passkeys || []).map((credential) => ({ id: credential.id, transports: credential.transports })),
        })
        await store.mutate((data) => { data.challenges[enrollmentKey(token)].challenge = options.challenge })
        send(response, 200, options)
        return true
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/test-enrollment/verify') {
        const input = await jsonBody(request)
        const token = String(input.token || '')
        const record = store.data.challenges[enrollmentKey(token)]
        const user = record && store.data.users[record.userId]
        if (!token || !record || record.expiresAt < Date.now() || !record.challenge || !user) throw new Error('Enrollment link is invalid or expired.')
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
        const session = createSession(user.id, sessionSecret, sessionTtlSeconds)
        send(response, 200, { enrolled: true, user: safeUser(user) }, { 'Set-Cookie': cookie('fp_session', session, origin, sessionTtlSeconds) })
        return true
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/google/start') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new Error('Google login is not configured.')
      const state = randomBytes(24).toString('base64url')
      const nonce = randomBytes(24).toString('base64url')
      const redirectUrl = google.generateAuthUrl({ access_type: 'online', prompt: 'select_account', scope: ['openid', 'email', 'profile'], state, nonce })
      response.writeHead(302, { Location: redirectUrl, 'Cache-Control': 'no-store', 'Set-Cookie': [cookie('fp_google_state', state, origin), cookie('fp_google_nonce', nonce, origin)] })
      response.end()
      return true
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/google/callback') {
      const cookies = parseCookies(request)
      if (!url.searchParams.get('code') || url.searchParams.get('state') !== cookies.fp_google_state) throw new Error('Invalid Google login state.')
      const { tokens } = await google.getToken(url.searchParams.get('code'))
      const ticket = await google.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID })
      const claims = ticket.getPayload()
      if (!claims?.sub || !claims.email || !claims.email_verified || claims.nonce !== cookies.fp_google_nonce) throw new Error('Google identity could not be verified.')
      const normalizedEmail = claims.email.toLowerCase()
      const existing = store.findByEmail(normalizedEmail)
      const user = existing || { id: `google:${claims.sub}`, email: normalizedEmail, passkeys: [], createdAt: new Date().toISOString() }
      Object.assign(user, { name: claims.name || normalizedEmail, picture: claims.picture, updatedAt: new Date().toISOString() })
      await store.mutate((data) => { data.users[user.id] = user })
      const token = createSession(user.id, sessionSecret, sessionTtlSeconds)
      response.writeHead(302, { Location: origin, 'Cache-Control': 'no-store', 'Set-Cookie': [cookie('fp_session', token, origin, sessionTtlSeconds), cookie('fp_google_state', '', origin, 0), cookie('fp_google_nonce', '', origin, 0)] })
      response.end()
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/passkeys/register/options') {
      const userId = sessionUser(request, verifyToken)
      const user = userId && store.data.users[userId]
      if (!user) throw new Error('Authentication required.')
      const options = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: (user.passkeys || []).map((credential) => ({ id: credential.id, transports: credential.transports })),
      })
      await store.mutate((data) => { data.challenges[`register:${user.id}`] = { value: options.challenge, expiresAt: Date.now() + 300_000 } })
      send(response, 200, options)
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/passkeys/register/verify') {
      const userId = sessionUser(request, verifyToken)
      const user = userId && store.data.users[userId]
      const challenge = user && store.data.challenges[`register:${user.id}`]
      if (!user || !challenge || challenge.expiresAt < Date.now()) throw new Error('Passkey registration expired.')
      const verification = await verifyRegistrationResponse({ response: await jsonBody(request), expectedChallenge: challenge.value, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: true })
      if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey registration failed.')
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
      await store.mutate((data) => {
        data.users[user.id].passkeys ||= []
        data.users[user.id].passkeys.push({ id: credential.id, publicKey: b64(credential.publicKey), counter: credential.counter, transports: credential.transports, deviceType: credentialDeviceType, backedUp: credentialBackedUp })
        delete data.challenges[`register:${user.id}`]
      })
      send(response, 200, { verified: true })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/passkeys/authenticate/options') {
      const { email } = await jsonBody(request)
      const user = store.findByEmail(String(email || ''))
      const options = await generateAuthenticationOptions({
        rpID: rpId,
        userVerification: 'required',
        allowCredentials: user?.passkeys?.length
          ? user.passkeys.map((credential) => ({ id: credential.id, transports: credential.transports }))
          : undefined,
      })
      if (user?.passkeys?.length) {
        await store.mutate((data) => { data.challenges[`authenticate:${user.id}`] = { value: options.challenge, expiresAt: Date.now() + 300_000 } })
      }
      send(response, 200, options)
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/passkeys/authenticate/verify') {
      const responseBody = await jsonBody(request)
      const user = store.findByCredential(responseBody.id)
      const stored = user?.passkeys?.find((credential) => credential.id === responseBody.id)
      const challenge = user && store.data.challenges[`authenticate:${user.id}`]
      if (!user || !stored || !challenge || challenge.expiresAt < Date.now()) throw new Error('Passkey authentication expired.')
      const verification = await verifyAuthenticationResponse({
        response: responseBody,
        expectedChallenge: challenge.value,
        expectedOrigin: origin,
        expectedRPID: rpId,
        requireUserVerification: true,
        credential: { id: stored.id, publicKey: unb64(stored.publicKey), counter: stored.counter, transports: stored.transports },
      })
      if (!verification.verified) throw new Error('Passkey authentication failed.')
      await store.mutate((data) => { stored.counter = verification.authenticationInfo.newCounter; delete data.challenges[`authenticate:${user.id}`] })
      const token = createSession(user.id, sessionSecret, sessionTtlSeconds)
      send(response, 200, { authenticated: true, user: safeUser(user) }, { 'Set-Cookie': cookie('fp_session', token, origin, sessionTtlSeconds) })
      return true
    }

    send(response, 404, { error: 'Not found.' })
    return true
  }
}
