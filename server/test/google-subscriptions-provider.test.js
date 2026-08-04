import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createGoogleSubscriptionAuthorizationUrl,
  googleSubscriptionCapability,
  syncGoogleSubscriptionSource,
} from '../src/google-subscriptions-provider.js'

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

test('Google subscription capability fails closed until explicitly enabled and configured', () => {
  const disabled = googleSubscriptionCapability({})
  assert.equal(disabled.enabled, false)
  assert.equal(disabled.source, 'gmail')
  assert.equal(disabled.configured, false)
  assert.equal(disabled.ready, false)
  assert.equal(disabled.reason, 'disabled')
  assert.deepEqual(disabled.requiredScopes, ['openid', 'email', 'profile', GMAIL_SCOPE])
  assert.ok(Array.isArray(disabled.limitations) && disabled.limitations.length >= 1)

  const enabled = googleSubscriptionCapability({ GOOGLE_SUBSCRIPTIONS_ENABLED: 'true' })
  assert.equal(enabled.enabled, true)
  assert.equal(enabled.ready, false)
  assert.equal(enabled.reason, 'missing_oauth_configuration')
  const custom = googleSubscriptionCapability({
    GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
    GOOGLE_SUBSCRIPTIONS_SOURCE: 'custom',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
  })
  assert.equal(custom.ready, false)
  assert.equal(custom.reason, 'missing_data_source')
})

test('authorization URL uses Google OAuth, adds Gmail read-only scope and preserves state without exposing secrets', () => {
  const env = {
    GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
    GOOGLE_SUBSCRIPTIONS_SOURCE: 'gmail',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'server-secret',
    GOOGLE_SUBSCRIPTIONS_SCOPES: 'openid email profile',
  }
  const result = new URL(createGoogleSubscriptionAuthorizationUrl({ env, state: 'signed-state', redirectUri: 'https://finance.example/api/subscriptions/google/callback' }))
  assert.equal(result.origin, 'https://accounts.google.com')
  assert.equal(result.searchParams.get('state'), 'signed-state')
  assert.equal(result.searchParams.get('access_type'), 'offline')
  assert.equal(result.searchParams.get('prompt'), 'consent')
  assert.match(result.searchParams.get('scope'), /gmail\.readonly/)
  assert.equal(result.toString().includes('server-secret'), false)
})

test('authorization rejects insecure callback URLs', () => {
  const env = { GOOGLE_SUBSCRIPTIONS_ENABLED: 'true', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }
  assert.throws(() => createGoogleSubscriptionAuthorizationUrl({ env, state: 'state', redirectUri: 'http://example.test/callback' }), /HTTPS/)
})

test('Gmail source lists narrow receipt matches, reads metadata only and normalizes high-confidence subscriptions', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url)
    requests.push({ url: parsed, options })
    if (parsed.pathname.endsWith('/messages')) {
      return new Response(JSON.stringify({ messages: [{ id: 'message_1' }, { id: 'message_2' }] }), { status: 200 })
    }
    if (parsed.pathname.endsWith('/message_1')) {
      return new Response(JSON.stringify({
        id: 'message_1',
        internalDate: '1785801600000',
        snippet: 'Your monthly renewal was charged EUR 1.99.',
        payload: { headers: [
          { name: 'From', value: 'Google Play <googleplay-noreply@google.com>' },
          { name: 'Subject', value: 'Receipt for “Google One” subscription renewal' },
        ] },
      }), { status: 200 })
    }
    return new Response(JSON.stringify({
      id: 'message_2',
      snippet: 'Monthly renewal EUR 9.99.',
      payload: { headers: [
        { name: 'From', value: 'Attacker <billing@example.test>' },
        { name: 'Subject', value: '“Fake subscription” renewal' },
      ] },
    }), { status: 200 })
  }

  const env = {
    GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
    GOOGLE_SUBSCRIPTIONS_SOURCE: 'gmail',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_SUBSCRIPTIONS_MAX_MESSAGES: '20',
  }
  const result = await syncGoogleSubscriptionSource({ accessToken: 'token', tokenType: 'Bearer' }, env)
  assert.equal(result.connected, true)
  assert.equal(result.source, 'gmail')
  assert.equal(result.subscriptions.length, 1)
  assert.deepEqual(result.subscriptions[0], {
    externalId: 'gmail:message_1',
    provider: 'Google Play (Gmail-Beleg)',
    product: 'Google One',
    amountCents: 199,
    currency: 'EUR',
    billingInterval: 'monthly',
    nextChargeDate: undefined,
    status: 'active',
  })
  assert.ok(result.limitations.some((entry) => /keine vollständige|nicht.*vollständig/i.test(entry)))
  const listRequest = requests.find((entry) => entry.url.pathname.endsWith('/messages'))
  assert.match(listRequest.url.searchParams.get('q'), /googleplay-noreply/)
  assert.equal(listRequest.url.searchParams.get('maxResults'), '20')
  const detailRequest = requests.find((entry) => entry.url.pathname.endsWith('/message_1'))
  assert.equal(detailRequest.url.searchParams.get('format'), 'metadata')
  assert.deepEqual(detailRequest.url.searchParams.getAll('metadataHeaders'), ['Subject', 'From', 'Date'])
  assert.equal(requests.every((entry) => entry.options.headers.Authorization === 'Bearer token'), true)
})

test('custom source normalizes and deduplicates supported records', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response(JSON.stringify({ subscriptions: [
    { externalId: 'one', provider: 'Google Play', product: 'Storage', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active', nextChargeDate: '2026-09-01' },
    { externalId: 'one', provider: 'Google Play', product: 'Storage updated', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active' },
  ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const env = {
    GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
    GOOGLE_SUBSCRIPTIONS_SOURCE: 'custom',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://example.test/data',
  }
  const result = await syncGoogleSubscriptionSource({ accessToken: 'token', tokenType: 'Bearer' }, env)
  assert.equal(result.connected, true)
  assert.equal(result.source, 'custom')
  assert.equal(result.subscriptions.length, 1)
  assert.equal(result.subscriptions[0].product, 'Storage updated')
})

test('custom sync rejects malformed provider responses', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => new Response('{not-json', { status: 200 })
  const env = {
    GOOGLE_SUBSCRIPTIONS_ENABLED: 'true',
    GOOGLE_SUBSCRIPTIONS_SOURCE: 'custom',
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_SUBSCRIPTIONS_DATA_SOURCE: 'https://example.test/data',
  }
  await assert.rejects(() => syncGoogleSubscriptionSource({ accessToken: 'token' }, env), /malformed JSON/)
})
