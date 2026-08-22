import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createOpenBankingProviderRegistry } from '../src/providers.js'

// Coverage for the safe, minimal widget descriptor EnableBankingProvider.start()
// returns for Enable Banking's official Auth Flow widget
// (<enablebanking-auth-flow>, https://enablebanking.com/docs/api/widgets/#auth-flow),
// added 2026-08-22. Built ONLY from Enable Banking's own POST /auth
// response -- there is no channel for a client-supplied value to reach it.

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

function fakeBankingCore() {
  return { async validateReadOnlyScope() { return true } }
}

function eligibleEnv(overrides = {}) {
  return { ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey, ...overrides }
}

function withRestoredFetch(run) {
  const originalFetch = globalThis.fetch
  return run().finally(() => { globalThis.fetch = originalFetch })
}

const ASPSPS = [{ name: 'ING-DiBa', country: 'DE', bic: 'INGDDEFFXXX' }]

function mockAuthFetch(authResponseOverrides = {}) {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
    if (url.endsWith('/auth')) return new Response(JSON.stringify({ url: 'https://auth.enablebanking.com/ais/auth-1', authorization_id: 'auth-1', ...authResponseOverrides }), { status: 200 })
    throw new Error(`Unexpected URL in enable-banking auth-flow test: ${url}`)
  }
  return requests
}

async function start(env = eligibleEnv(), institutionId = 'DE:ING-DiBa') {
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('enablebanking')
  return adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId })
}

test('1. returns a widget descriptor after a successful POST /auth', () => withRestoredFetch(async () => {
  mockAuthFetch()
  const result = await start()
  assert.ok(result.authFlow, 'authFlow must be present for a normal successful response')
  assert.equal(result.authFlow.provider, 'enablebanking')
}))

test('2. authorizationId matches response.authorization_id exactly', () => withRestoredFetch(async () => {
  mockAuthFetch({ authorization_id: 'a-very-specific-id-123' })
  const result = await start()
  assert.equal(result.authFlow.authorizationId, 'a-very-specific-id-123')
}))

test('3. origin is derived only from response.url, discarding path/query -- never the browser-supplied redirectUri', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://auth.enablebanking.com/ais/some/deep/path?foo=bar&baz=qux' })
  // redirectUri below is a totally different, attacker-plausible origin --
  // it must have zero influence on authFlow.origin.
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')
  const result = await adapter.start({ state: 's', redirectUri: 'https://attacker-controlled.example/whatever', country: 'DE', institutionId: 'DE:ING-DiBa' })
  assert.equal(result.authFlow.origin, 'https://auth.enablebanking.com')
}))

test('4. the sandbox/live Enable Banking host is honored even when it differs from auth.enablebanking.com (confirmed live: tilisy-sandbox.enablebanking.com)', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://tilisy-sandbox.enablebanking.com/ais/auth-1' })
  const result = await start()
  assert.equal(result.authFlow.origin, 'https://tilisy-sandbox.enablebanking.com')
}))

test('5. an HTTP (non-HTTPS) authorization URL never produces a widget descriptor', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'http://auth.enablebanking.com/ais/auth-1' })
  await assert.rejects(start(), /secure authorization URL/)
}))

test('6. a non-Enable-Banking-owned hostname never produces a widget descriptor, even though the redirect itself still succeeds', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://evil.example/ais/auth-1' })
  const result = await start()
  assert.equal(result.authFlow, null, 'an off-allowlist hostname must fail closed to no widget, not throw and not fall back to some other host')
  assert.equal(result.redirectUrl, 'https://evil.example/ais/auth-1', 'the plain redirect is a provider-response fidelity concern separate from widget-origin validation and is unaffected')
}))

test('6b. a hostname that merely ends with the allowed suffix as a substring, not a real subdomain, is rejected', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://notenablebanking.com.evil.example/ais/auth-1' })
  const result = await start()
  assert.equal(result.authFlow, null)
}))

test('7. embedded userinfo in the authorization URL is rejected', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://user:pass@auth.enablebanking.com/ais/auth-1' })
  const result = await start()
  assert.equal(result.authFlow, null)
}))

test('8. a malformed authorization URL is rejected without throwing', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://[::1' })
  const result = await start()
  assert.equal(result.authFlow, null)
}))

test('9a. a missing authorization_id produces no widget descriptor', () => withRestoredFetch(async () => {
  mockAuthFetch({ authorization_id: undefined })
  const result = await start()
  assert.equal(result.authFlow, null)
  assert.ok(result.redirectUrl, 'the plain redirect must still be usable even without a widget descriptor')
}))

test('9b. an authorization_id containing unsafe characters produces no widget descriptor', () => withRestoredFetch(async () => {
  mockAuthFetch({ authorization_id: '<script>alert(1)</script>' })
  const result = await start()
  assert.equal(result.authFlow, null)
}))

test('9c. an absurdly long authorization_id produces no widget descriptor', () => withRestoredFetch(async () => {
  mockAuthFetch({ authorization_id: 'a'.repeat(500) })
  const result = await start()
  assert.equal(result.authFlow, null)
}))

test('10. the widget descriptor never carries the signed state, credential, or anything beyond provider/authorizationId/origin/sandbox', () => withRestoredFetch(async () => {
  mockAuthFetch()
  const result = await start()
  assert.deepEqual(Object.keys(result.authFlow).sort(), ['authorizationId', 'origin', 'provider', 'sandbox'])
}))

test('11. redirectUrl is still the exact provider-returned URL regardless of whether a widget descriptor was produced', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://evil.example/ais/auth-1' })
  const result = await start()
  assert.equal(result.redirectUrl, 'https://evil.example/ais/auth-1')
}))

test('sandbox: explicit ENABLE_BANKING_SANDBOX=true always wins, even against a production-looking host', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://auth.enablebanking.com/ais/auth-1' })
  const result = await start(eligibleEnv({ ENABLE_BANKING_SANDBOX: 'true' }))
  assert.equal(result.authFlow.sandbox, true)
}))

test('sandbox: explicit ENABLE_BANKING_SANDBOX=false always wins, even against a sandbox-looking host', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://tilisy-sandbox.enablebanking.com/ais/auth-1' })
  const result = await start(eligibleEnv({ ENABLE_BANKING_SANDBOX: 'false' }))
  assert.equal(result.authFlow.sandbox, false)
}))

test('sandbox: with no explicit setting, infers true only from a positive hostname signal', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://tilisy-sandbox.enablebanking.com/ais/auth-1' })
  const result = await start(eligibleEnv())
  assert.equal(result.authFlow.sandbox, true)
}))

test('sandbox: with no explicit setting and a production-looking host, never silently defaults to sandbox', () => withRestoredFetch(async () => {
  mockAuthFetch({ url: 'https://auth.enablebanking.com/ais/auth-1' })
  const result = await start(eligibleEnv())
  assert.equal(result.authFlow.sandbox, false)
}))

// 12. GoCardless/PayPal start responses/redirect behavior remain unchanged
// -- authFlow is an Enable Banking-only concept; neither adapter's start()
// result should ever carry the field, so server.js's `result.authFlow ?
// ... : undefined` branch is always the `undefined` arm for them.
test('12. GoCardless.start() never returns an authFlow field', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/token/new/')) return new Response(JSON.stringify({ access: 'access-token', access_expires: 3600 }), { status: 200 })
    if (url.includes('/institutions/?country=')) return new Response(JSON.stringify([{ id: 'ING_INGDDEFF', name: 'ING-DiBa', bic: 'INGDDEFFXXX' }]), { status: 200 })
    if (url.endsWith('/agreements/enduser/')) return new Response(JSON.stringify({ id: 'agreement-1' }), { status: 200 })
    if (url.endsWith('/requisitions/')) return new Response(JSON.stringify({ id: 'requisition-1', link: 'https://ob.gocardless.com/psd2/start/req-1' }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry({ GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }, fakeBankingCore()).get('gocardless')
  const result = await adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'ING_INGDDEFF' })
  assert.equal(result.authFlow, undefined)
  assert.equal(result.redirectUrl, 'https://ob.gocardless.com/psd2/start/req-1')
}))

test('12. PayPal owner-mode start() never returns an authFlow field', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
    if (url.includes('/v1/reporting/balances')) return new Response(JSON.stringify({ balances: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const env = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_OWNER_USER_ID: 'owner-1' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('paypal')
  const result = await adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections' })
  assert.equal(result.authFlow, undefined)
}))
