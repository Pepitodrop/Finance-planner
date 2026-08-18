import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenBankingProviderRegistry } from '../src/providers.js'

function fakeBankingCore() {
  return {
    async validateReadOnlyScope() { return true },
  }
}

function withRestoredFetch(run) {
  const originalFetch = globalThis.fetch
  return run().finally(() => { globalThis.fetch = originalFetch })
}

test('GoCardless disconnect asks the provider to end the requisition and only reports revoked when it confirms', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, method: init.method || 'GET' })
    if (url.endsWith('/requisitions/req-1/') && init.method === 'DELETE') return new Response(null, { status: 204 })
    throw new Error(`Unexpected URL in disconnect test: ${url}`)
  }
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.disconnect({ requisitionId: 'req-1', token: { access: 'still-valid', accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } })

  assert.deepEqual(result, { revoked: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].method, 'DELETE')
}))

test('GoCardless disconnect treats an already-gone requisition (404) as already revoked, not a failure', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).endsWith('/requisitions/req-1/') && init.method === 'DELETE') return new Response('', { status: 404 })
    throw new Error('Unexpected URL')
  }
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.disconnect({ requisitionId: 'req-1', token: { access: 'still-valid', accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } })

  assert.deepEqual(result, { revoked: true })
}))

test('GoCardless disconnect never claims revocation when the provider call fails, and does not throw', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 500 })
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.disconnect({ requisitionId: 'req-1', token: { access: 'still-valid', accessExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } })

  assert.deepEqual(result, { revoked: false, reason: 'provider_error' })
}))

test('GoCardless disconnect refreshes an expired token before attempting revocation', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/token/new/')) return new Response(JSON.stringify({ access: 'fresh-token', access_expires: 3600 }), { status: 200 })
    if (url.endsWith('/requisitions/req-1/') && init.method === 'DELETE') {
      assert.equal(init.headers.Authorization, 'Bearer fresh-token')
      return new Response(null, { status: 204 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.disconnect({ requisitionId: 'req-1', token: { access: 'stale', accessExpiresAt: new Date(0).toISOString() } })

  assert.deepEqual(result, { revoked: true })
  assert.ok(requests.some((url) => url.endsWith('/token/new/')))
}))

test('GoCardless disconnect with no stored requisition is not_applicable rather than attempting a call', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must not call the provider without a requisitionId') }
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.disconnect({})

  assert.deepEqual(result, { revoked: false, reason: 'not_applicable' })
}))

test('PayPal disconnect never claims revocation -- neither owner nor partner mode holds a per-connection provider token to revoke', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('PayPal disconnect must not call the provider') }
  const ownerEnv = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_OWNER_USER_ID: 'owner-1' }
  const ownerAdapter = createOpenBankingProviderRegistry(ownerEnv, fakeBankingCore()).get('paypal')
  assert.deepEqual(await ownerAdapter.disconnect({ mode: 'owner' }), { revoked: false, reason: 'not_applicable' })

  const partnerEnv = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_PARTNER_MERCHANT_ID: 'merchant-1' }
  const partnerAdapter = createOpenBankingProviderRegistry(partnerEnv, fakeBankingCore()).get('paypal')
  assert.deepEqual(await partnerAdapter.disconnect({ mode: 'partner' }), { revoked: false, reason: 'not_applicable' })
}))

test('a provider with no disconnect override (base OpenBankingProvider contract) reports not_supported rather than a false positive', () => withRestoredFetch(async () => {
  const adapter = createOpenBankingProviderRegistry({}, fakeBankingCore()).get('finapi')
  assert.deepEqual(await adapter.disconnect({}), { revoked: false, reason: 'not_supported' })
}))
