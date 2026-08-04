import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGoogleSubscriptionAuthorizationUrl,
  googleSubscriptionCapability,
  syncGoogleSubscriptionSource,
} from '../src/google-subscriptions-provider.js'

test('Google subscription capability fails closed until explicitly enabled and configured', () => {
  assert.deepEqual(googleSubscriptionCapability({}), { enabled: false, configured: false, ready: false, reason: 'disabled' })
  assert.deepEqual(googleSubscriptionCapability({ GOOGLE_SUBSCRIPTIONS_ENABLED: 'true' }), { enabled: true, configured: false, ready: false, reason: 'missing_configuration' })
})

test('authorization URL uses Google OAuth and preserves state without exposing secrets', () => {
  const env = {
    GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'server-secret',
    GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://example.test/subscriptions',
    GOOGLE_SUBSCRIPTIONS_SCOPES: 'openid email profile',
  }
  const result = new URL(createGoogleSubscriptionAuthorizationUrl({ env, state: 'signed-state', redirectUri: 'https://finance.example/api/subscriptions/google/callback' }))
  assert.equal(result.origin, 'https://accounts.google.com')
  assert.equal(result.searchParams.get('state'), 'signed-state')
  assert.equal(result.searchParams.get('access_type'), 'offline')
  assert.equal(result.searchParams.get('prompt'), 'consent')
  assert.equal(result.toString().includes('server-secret'), false)
})

test('authorization rejects insecure callback URLs', () => {
  const env = { GOOGLE_SUBSCRIPTIONS_ENABLED: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://example.test/data' }
  assert.throws(() => createGoogleSubscriptionAuthorizationUrl({ env, state: 'state', redirectUri: 'http://example.test/callback' }), /HTTPS/)
})

test('sync normalizes and deduplicates supported source records', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response(JSON.stringify({ subscriptions: [
    { externalId: 'one', provider: 'Google Play', product: 'Storage', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active', nextChargeDate: '2026-09-01' },
    { externalId: 'one', provider: 'Google Play', product: 'Storage updated', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active' },
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const env = { GOOGLE_SUBSCRIPTIONS_ENABLED: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://example.test/data' }
  const result = await syncGoogleSubscriptionSource({ accessToken: 'token', tokenType: 'Bearer' }, env)
  assert.equal(result.connected, true)
  assert.equal(result.subscriptions.length, 1)
  assert.equal(result.subscriptions[0].product, 'Storage updated')
})

test('sync rejects malformed provider responses', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response('{not-json', { status: 200 })
  const env = { GOOGLE_SUBSCRIPTIONS_ENABLED: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://example.test/data' }
  await assert.rejects(() => syncGoogleSubscriptionSource({ accessToken: 'token' }, env), /malformed JSON/)
})
