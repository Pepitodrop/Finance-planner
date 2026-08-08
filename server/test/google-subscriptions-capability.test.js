import assert from 'node:assert/strict'
import test from 'node:test'
import { createGoogleSubscriptionsRouter } from '../src/google-subscriptions-router.js'

function response() {
  return {
    status: 0,
    payload: null,
    writeHead(status) { this.status = status },
    end(value) { this.payload = value ? JSON.parse(value) : null },
  }
}

function handlerFixture() {
  let stored = { status: 'connected', accessToken: 'encrypted-at-rest', lastSyncAt: '2026-08-04T12:00:00.000Z' }
  const capability = {
    enabled: true,
    source: 'gmail',
    configured: true,
    ready: true,
    requiredScopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
    limitations: ['Receipt-derived and not a complete subscription list.'],
  }
  return createGoogleSubscriptionsRouter({
    env: {},
    origin: 'https://finance.example',
    sessionSecret: 's'.repeat(64),
    userId: () => 'user-1',
    body: async () => ({}),
    send(res, status, payload) { res.writeHead(status); res.end(JSON.stringify(payload)) },
    store: {
      async get() { return stored },
      async set(_user, _provider, value) { stored = value },
      async remove() { stored = null },
    },
    adapter: {
      capability: () => capability,
      async syncSource() {
        return {
          connected: true,
          source: 'gmail',
          lastSyncAt: '2026-08-04T13:00:00.000Z',
          limitations: capability.limitations,
          subscriptions: [{ externalId: 'gmail:one', provider: 'Google Play (Gmail-Beleg)', product: 'Google One', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active' }],
          credential: { accessToken: 'refreshed' },
        }
      },
    },
  })
}

test('capability endpoint exposes source, scopes and connection state without credentials', async () => {
  const handler = handlerFixture()
  const res = response()
  const handled = await handler({ method: 'GET' }, res, new URL('https://finance.example/api/subscriptions/google/capability'))
  assert.equal(handled, true)
  assert.equal(res.status, 200)
  assert.equal(res.payload.ready, true)
  assert.equal(res.payload.source, 'gmail')
  assert.equal(res.payload.connected, true)
  assert.match(res.payload.requiredScopes.join(' '), /gmail\.readonly/)
  assert.equal(JSON.stringify(res.payload).includes('encrypted-at-rest'), false)
})

test('sync response labels Gmail receipt source and its limitations', async () => {
  const handler = handlerFixture()
  const res = response()
  await handler({ method: 'POST' }, res, new URL('https://finance.example/api/subscriptions/google/sync'))
  assert.equal(res.status, 200)
  assert.equal(res.payload.connected, true)
  assert.equal(res.payload.source, 'gmail')
  assert.equal(res.payload.subscriptions.length, 1)
  assert.deepEqual(res.payload.limitations, ['Receipt-derived and not a complete subscription list.'])
})
