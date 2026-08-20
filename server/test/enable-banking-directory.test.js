import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createOpenBankingProviderRegistry } from '../src/providers.js'

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

const ASPSPS = [
  { name: 'ING-DiBa', country: 'DE', bic: 'INGDDEFFXXX', logo: 'https://cdn.enablebanking.example/ing.svg', auth_methods: ['redirect'], psu_types: ['personal'], maximum_consent_validity: 180, beta: false, upstream_secret: 'should-never-leak' },
  { name: 'Aachener Sparkasse', country: 'DE', bic: 'AACSDE33' },
]

test('lists an authenticated GET /aspsps request and returns only sanitized fields', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), headers: init.headers })
    return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const institutions = await adapter.institutionDirectory('DE')

  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /^https:\/\/api\.enablebanking\.com\/aspsps\?country=DE$/)
  assert.match(requests[0].headers.Authorization, /^Bearer ey/)
  assert.deepEqual(institutions, [
    { id: 'DE:ING-DiBa', name: 'ING-DiBa', country: 'DE', bic: 'INGDDEFFXXX', logo: 'https://cdn.enablebanking.example/ing.svg' },
    { id: 'DE:Aachener Sparkasse', name: 'Aachener Sparkasse', country: 'DE', bic: 'AACSDE33' },
  ])
  for (const institution of institutions) {
    assert.ok(!('auth_methods' in institution))
    assert.ok(!('psu_types' in institution))
    assert.ok(!('maximum_consent_validity' in institution))
    assert.ok(!('beta' in institution))
    assert.ok(!('upstream_secret' in institution))
  }
}))

test('omits bic/logo when the upstream ASPSP does not provide them, never inventing empty strings', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ aspsps: [{ name: 'Trade Republic Bank', country: 'DE' }] }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const institutions = await adapter.institutionDirectory('DE')

  assert.deepEqual(institutions, [{ id: 'DE:Trade Republic Bank', name: 'Trade Republic Bank', country: 'DE' }])
}))

test('an empty upstream result is a valid empty array, not an error', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ aspsps: [] }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  assert.deepEqual(await adapter.institutionDirectory('DE'), [])
}))

test('a malformed response (missing aspsps array) throws instead of returning something unusable', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.institutionDirectory('DE'), /invalid/)
}))

test('a 500 from Enable Banking propagates as a rejection after jsonFetch retries, never a silent empty list', () => withRestoredFetch(async () => {
  let calls = 0
  globalThis.fetch = async () => { calls += 1; return new Response('', { status: 500 }) }
  const adapter = createOpenBankingProviderRegistry({ ...eligibleEnv(), PROVIDER_RETRIES: '1', PROVIDER_TIMEOUT_MS: '2000' }, fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.institutionDirectory('DE'))
  assert.ok(calls >= 2, 'jsonFetch should retry a 5xx before giving up')
}))

test('a 429 from Enable Banking is retried the same way a 5xx is', () => withRestoredFetch(async () => {
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '0' } })
    return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const institutions = await adapter.institutionDirectory('DE')
  assert.equal(calls, 2)
  assert.equal(institutions.length, 2)
}))

test('caches the directory per country instead of hitting Enable Banking on every request', () => withRestoredFetch(async () => {
  let calls = 0
  globalThis.fetch = async (input) => {
    calls += 1
    assert.match(String(input), /country=DE$/)
    return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await adapter.institutionDirectory('DE')
  await adapter.institutionDirectory('DE')
  assert.equal(calls, 1)
}))

test('caches per country independently -- a different country still triggers its own fetch', () => withRestoredFetch(async () => {
  const seen = []
  globalThis.fetch = async (input) => {
    seen.push(String(input))
    return new Response(JSON.stringify({ aspsps: [] }), { status: 200 })
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await adapter.institutionDirectory('DE')
  await adapter.institutionDirectory('FI')
  assert.equal(seen.length, 2)
}))

test('the directory fails closed when Enable Banking is not configured', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must not be called when unconfigured') }
  const adapter = createOpenBankingProviderRegistry({}, fakeBankingCore()).get('enablebanking')

  await assert.rejects(
    adapter.institutionDirectory('DE'),
    (error) => error.status === 503 && error.code === 'provider_not_configured',
  )
}))

test('describe() reports available and configured only when both application id and a key source are present', () => {
  const configured = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking').describe()
  assert.equal(configured.id, 'enablebanking')
  assert.equal(configured.displayName, 'Bank connection')
  assert.equal(configured.configured, true)
  assert.equal(configured.available, true)

  const unconfigured = createOpenBankingProviderRegistry({}, fakeBankingCore()).get('enablebanking').describe()
  assert.equal(unconfigured.configured, false)
})
