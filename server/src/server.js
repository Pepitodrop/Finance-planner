import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import { EncryptedStore } from './crypto-store.js'
import { createSession, issueState, verifySession, verifyState } from './security.js'
import { startGoCardless, startPayPal, syncGoCardless, syncPayPal } from './providers.js'

const env = process.env
const port = Number(env.PORT || 8787)
const host = env.HOST || '127.0.0.1'
const origin = env.APP_ORIGIN || 'http://localhost:5173'
const sessionSecret = env.SESSION_SECRET || ''
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.')
if (!['127.0.0.1', '0.0.0.0', '::'].includes(host)) throw new Error('HOST must be 127.0.0.1, 0.0.0.0, or ::.')
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.')
const store = new EncryptedStore(env.CONNECTOR_STORE_PATH || './data/connectors.enc.json', env.CONNECTOR_MASTER_KEY || '')
await store.load()

function send(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  })
  response.end(JSON.stringify(payload))
}

async function body(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('Request body too large.')
    chunks.push(chunk)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
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
  response.setHeader('Vary', 'Origin')
  return true
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
  if (redirect.origin !== origin) throw new Error('Invalid redirect origin.')
  const consentId = randomUUID()
  const state = issueState(user, provider, sessionSecret, { consentId, redirectUri: redirect.toString() })
  const claims = verifyState(state, provider, sessionSecret)
  const result = provider === 'gocardless'
    ? await startGoCardless({ env, state, redirectUri: redirect.toString(), country: input.country || 'DE' })
    : provider === 'paypal'
      ? await startPayPal({ env, state, redirectUri: redirect.toString() })
      : (() => { throw new Error('finAPI adapter requires a licensed finAPI tenant and is not configured yet.') })()
  await store.createConnectionSetup({
    userId: user,
    provider,
    consentId,
    redirectUri: redirect.toString(),
    nonce: claims.nonce,
    expiresAt: claims.exp * 1000,
    connection: {
      ...result.credential,
      consentId,
      redirectUri: redirect.toString(),
      state,
      createdAt: new Date().toISOString(),
    },
  })
  send(response, 200, { redirectUrl: result.redirectUrl })
}

async function sync(request, response) {
  const user = userId(request)
  const results = []
  for (const provider of ['gocardless', 'finapi', 'paypal']) {
    const stored = store.get(user, provider)
    if (!stored) continue
    try {
      const synced = provider === 'gocardless' ? await syncGoCardless(stored, env)
        : provider === 'paypal' ? await syncPayPal(stored, env)
          : (() => { throw new Error('finAPI adapter is not configured.') })()
      const lastSyncAt = new Date().toISOString()
      await store.set(user, provider, { ...synced.credential, consentId: stored.consentId, redirectUri: stored.redirectUri, lastSyncAt, consentExpiresAt: synced.consentExpiresAt })
      results.push({ connection: { ...connection(provider, stored), lastSyncAt }, accounts: synced.accounts, transactions: synced.transactions })
    } catch (error) {
      results.push({ connection: connection(provider, stored, error instanceof Error ? error.message : 'Synchronization failed.'), accounts: [], transactions: [] })
    }
  }
  send(response, 200, { connections: results })
}

const server = createServer(async (request, response) => {
  try {
    if (!cors(request, response)) return send(response, 403, { error: 'Origin not allowed.' })
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' })
      return response.end()
    }
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { status: 'ok', service: 'finance-planner-connector', version: '0.1.0' })
    if (request.method === 'POST' && url.pathname === '/api/session/local') {
      if (env.AUTH_MODE !== 'local') return send(response, 404, { error: 'Not found.' })
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
      if (!['gocardless', 'finapi', 'paypal'].includes(provider)) throw new Error('Unknown connector provider.')
      const state = verifyState(url.searchParams.get('state'), provider, sessionSecret)
      if (!state.consentId || !state.redirectUri) throw new Error('Consent state is incomplete.')
      const activated = await store.activateConnection({
        nonce: state.nonce,
        consentId: state.consentId,
        userId: state.sub,
        provider,
        redirectUri: state.redirectUri,
        now: Date.now(),
        connectedAt: new Date().toISOString(),
      })
      if (!activated) throw new Error('Consent state was already used, expired, or does not match.')
      response.writeHead(302, { Location: state.redirectUri, 'Cache-Control': 'no-store' })
      return response.end()
    }
    send(response, 404, { error: 'Not found.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.'
    send(response, /Authentication|session/i.test(message) ? 401 : 400, { error: message })
  }
})

server.listen(port, host, () => console.log(`Connector server listening on http://${host}:${port}`))
