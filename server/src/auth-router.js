import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { OAuth2Client } from 'google-auth-library'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { createSession, verifySession } from './security.js'

const b64 = (value) => Buffer.from(value).toString('base64url')
const unb64 = (value) => new Uint8Array(Buffer.from(value, 'base64url'))

class AuthStore {
  constructor(path, key) {
    if (String(key).length < 32) throw new Error('AUTH_MASTER_KEY must contain at least 32 characters.')
    this.path = path
    this.key = createHash('sha256').update(key).digest()
    this.data = { users: {}, challenges: {} }
    this.queue = Promise.resolve()
  }

  async load() {
    try {
      const envelope = JSON.parse(await readFile(this.path, 'utf8'))
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(envelope.iv, 'base64url'))
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
      this.data = JSON.parse(Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  async mutate(operation) {
    this.queue = this.queue.then(async () => {
      const result = operation(this.data)
      await mkdir(dirname(this.path), { recursive: true })
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', this.key, iv)
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(this.data)), cipher.final()])
      const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify({ iv: b64(iv), tag: b64(cipher.getAuthTag()), ciphertext: b64(ciphertext) }), { mode: 0o600 })
      await rename(temporary, this.path)
      return result
    })
    return this.queue
  }

  findByEmail(email) {
    return Object.values(this.data.users).find((user) => user.email === email.toLowerCase())
  }

  findByCredential(id) {
    return Object.values(this.data.users).find((user) => user.passkeys?.some((credential) => credential.id === id))
  }
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim().split('=').map(decodeURIComponent)).filter((entry) => entry.length === 2))
}

function cookie(name, value, origin, maxAge = 600) {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${origin.startsWith('https://') ? '; Secure' : ''}`
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

function sessionUser(request, secret) {
  const token = parseCookies(request).fp_session
  return token ? verifySession(token, secret) : null
}

export async function createAuthRouter({ env, origin, sessionSecret, send }) {
  const rpId = env.WEBAUTHN_RP_ID || new URL(origin).hostname
  const rpName = env.WEBAUTHN_RP_NAME || 'Finance Planner'
  const store = new AuthStore(env.AUTH_STORE_PATH || './data/auth.enc.json', env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '')
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
      const userId = sessionUser(request, sessionSecret)
      const user = userId ? store.data.users[userId] : null
      send(response, 200, { authenticated: Boolean(user), user: user ? { id: user.id, email: user.email, name: user.name, picture: user.picture, passkeyCount: user.passkeys?.length || 0 } : null })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      send(response, 200, { authenticated: false }, { 'Set-Cookie': cookie('fp_session', '', origin, 0) })
      return true
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
      const existing = store.findByEmail(claims.email)
      const user = existing || { id: `google:${claims.sub}`, email: claims.email.toLowerCase(), passkeys: [] }
      Object.assign(user, { name: claims.name || claims.email, picture: claims.picture, updatedAt: new Date().toISOString() })
      await store.mutate((data) => { data.users[user.id] = user })
      const token = createSession(user.id, sessionSecret, 86400)
      response.writeHead(302, { Location: origin, 'Cache-Control': 'no-store', 'Set-Cookie': [cookie('fp_session', token, origin, 86400), cookie('fp_google_state', '', origin, 0), cookie('fp_google_nonce', '', origin, 0)] })
      response.end()
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/passkeys/register/options') {
      const userId = sessionUser(request, sessionSecret)
      const user = userId && store.data.users[userId]
      if (!user) throw new Error('Authentication required.')
      const options = await generateRegistrationOptions({
        rpName,
        rpID: rpId,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        attestationType: 'none',
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
        excludeCredentials: (user.passkeys || []).map((credential) => ({ id: credential.id, transports: credential.transports })),
      })
      await store.mutate((data) => { data.challenges[`register:${user.id}`] = { value: options.challenge, expiresAt: Date.now() + 300_000 } })
      send(response, 200, options)
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/passkeys/register/verify') {
      const userId = sessionUser(request, sessionSecret)
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
      if (!user?.passkeys?.length) throw new Error('No passkey is registered for this account.')
      const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'required', allowCredentials: user.passkeys.map((credential) => ({ id: credential.id, transports: credential.transports })) })
      await store.mutate((data) => { data.challenges[`authenticate:${user.id}`] = { value: options.challenge, expiresAt: Date.now() + 300_000 } })
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
      const token = createSession(user.id, sessionSecret, 86400)
      send(response, 200, { authenticated: true }, { 'Set-Cookie': cookie('fp_session', token, origin, 86400) })
      return true
    }

    send(response, 404, { error: 'Not found.' })
    return true
  }
}
