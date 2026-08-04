import assert from 'node:assert/strict'
import test from 'node:test'
import { createSession } from '../src/security.js'
import { createGoogleSubscriptionsRouter } from '../src/google-subscriptions-router.js'

const origin = 'https://finance.example'
const secret = 's'.repeat(64)
const env = {
  GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
  GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://data.example/subscriptions',
}

function memoryStore() {
  const connections = new Map()
  const nonces = new Map()
  return {
    async createConnectionSetup(input) {
      connections.set(`${input.userId}:${input.provider}`, input.connection)
      nonces.set(input.nonce, input)
    },
    async consumeOAuthNonce(input) {
      const stored = nonces.get(input.nonce)
      if (!stored || stored.expiresAt <= input.now || stored.consentId !== input.consentId || stored.userId !== input.userId || stored.provider !== input.provider || stored.redirectUri !== input.redirectUri) return false
      nonces.delete(input.nonce)
      return true
    },
    async get(user, provider) { return connections.get(`${user}:${provider}`) || null },
    async set(user, provider, value) { connections.set(`${user}:${provider}`, value) },
    async remove(user, provider) { connections.delete(`${user}:${provider}`) },
  }
}

function request(method, path, payload) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]
  return {
    method,
    headers: { cookie: `fp_session=${encodeURIComponent(createSession('user-1', secret))}`, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
    async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk },
  }
}

function response() {
  return {
    status: 0,
    headers: {},
    payload: null,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(value) { this.payload = value ? JSON.parse(value) : null },
  }
}

function jsonBody(req) {
  return (async () => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  })()
}

function userId(req) {
  const token = decodeURIComponent(req.headers.cookie.split('=')[1])
  const payload = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf8'))
  return payload.sub
}

function harness(store = memoryStore()) {
  const calls = { exchanges: 0, revokes: 0 }
  const handler = createGoogleSubscriptionsRouter({
    env, origin, sessionSecret: secret, store, body: jsonBody, userId,
    send(res, status, payload, headers = {}) { res.writeHead(status, headers); res.end(JSON.stringify(payload)) },
    adapter: {
      capability: () => ({ enabled: true, configured: true, ready: true }),
      createAuthorizationUrl: ({ state, redirectUri }) => `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
      async exchangeCode({ code }) { calls.exchanges += 1; return { accessToken: `access-${code}`, refreshToken: 'refresh', tokenType: 'Bearer' } },
      async syncSource() { return { connected: true, lastSyncAt: '2026-08-04T12:00:00.000Z', subscriptions: [{ externalId: 'sub-1', provider: 'Google Play', product: 'Storage', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active' }], credential: { accessToken: 'refreshed', refreshToken: 'refresh' } } },
      async revokeAccess() { calls.revokes += 1; return true },
    },
  })
  return { handler, store, calls }
}

test('start, callback, sync, and disconnect form a complete secure lifecycle', async () => {
  const { handler, calls } = harness()
  const startResponse = response()
  await handler(request('POST', '/api/subscriptions/google/start', { redirectUri: `${origin}/connections` }), startResponse, new URL(`${origin}/api/subscriptions/google/start`))
  assert.equal(startResponse.status, 200)
  const auth = new URL(startResponse.payload.redirectUrl)
  assert.equal(auth.origin, 'https://accounts.google.com')
  assert.equal(new URL(auth.searchParams.get('redirect_uri')).toString(), `${origin}/api/subscriptions/google/callback`)

  const callbackResponse = response()
  const callbackUrl = new URL(`${origin}/api/subscriptions/google/callback`)
  callbackUrl.searchParams.set('state', auth.searchParams.get('state'))
  callbackUrl.searchParams.set('code', 'code-1')
  await handler(request('GET', callbackUrl.pathname), callbackResponse, callbackUrl)
  assert.equal(callbackResponse.status, 302)
  assert.match(callbackResponse.headers.Location, /provider=google-subscriptions/)
  assert.equal(calls.exchanges, 1)

  const syncResponse = response()
  await handler(request('POST', '/api/subscriptions/google/sync'), syncResponse, new URL(`${origin}/api/subscriptions/google/sync`))
  assert.equal(syncResponse.payload.connected, true)
  assert.equal(syncResponse.payload.subscriptions.length, 1)

  const deleteResponse = response()
  await handler(request('DELETE', '/api/subscriptions/google', { deleteImportedData: true }), deleteResponse, new URL(`${origin}/api/subscriptions/google`))
  assert.deepEqual(deleteResponse.payload, { disconnected: true, revoked: true, deletedImportedData: true })
  assert.equal(calls.revokes, 1)
})

test('callback state is single-use and rejects replay', async () => {
  const { handler, calls } = harness()
  const startResponse = response()
  await handler(request('POST', '/api/subscriptions/google/start', { redirectUri: `${origin}/connections` }), startResponse, new URL(`${origin}/api/subscriptions/google/start`))
  const state = new URL(startResponse.payload.redirectUrl).searchParams.get('state')
  const callback = new URL(`${origin}/api/subscriptions/google/callback?state=${encodeURIComponent(state)}&code=first`)
  await handler(request('GET', callback.pathname), response(), callback)
  await assert.rejects(() => handler(request('GET', callback.pathname), response(), callback), /already used|expired|does not match/)
  assert.equal(calls.exchanges, 1)
})

test('start rejects a return URL on another origin', async () => {
  const { handler } = harness()
  await assert.rejects(
    () => handler(request('POST', '/api/subscriptions/google/start', { redirectUri: 'https://evil.example/callback' }), response(), new URL(`${origin}/api/subscriptions/google/start`)),
    /Invalid Google subscription return origin/,
  )
})
