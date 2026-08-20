import assert from 'node:assert/strict'
import test from 'node:test'
import { createOpenBankingProviderRegistry } from '../src/providers.js'

function fakeBankingCore() {
  return {
    async validateReadOnlyScope() { return true },
  }
}

const DIRECTORY = [
  { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33', logo: 'https://cdn.gocardless.example/aachen.svg', bank_secret: 'should-never-leak' },
  { id: 'ING_INGDDEFF', name: 'ING-DiBa', bic: 'INGDDEFFXXX' },
]

function mockFetch({ agreementId = 'agreement-1', requisitionId = 'requisition-1', requisitionLink = 'https://ob.gocardless.com/psd2/start/req-1' } = {}) {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, body: init.body ? JSON.parse(init.body) : undefined })
    if (url.endsWith('/token/new/')) return new Response(JSON.stringify({ access: 'access-token', access_expires: 3600 }), { status: 200 })
    if (url.includes('/institutions/?country=')) return new Response(JSON.stringify(DIRECTORY), { status: 200 })
    if (url.endsWith('/agreements/enduser/')) return new Response(JSON.stringify({ id: agreementId }), { status: 200 })
    if (url.endsWith('/requisitions/')) return new Response(JSON.stringify({ id: requisitionId, link: requisitionLink }), { status: 200 })
    throw new Error(`Unexpected URL in gocardless institution directory test: ${url}`)
  }
  return requests
}

function withRestoredFetch(run) {
  const originalFetch = globalThis.fetch
  return run().finally(() => { globalThis.fetch = originalFetch })
}

test('validates a user-selected institution against the live directory and uses it to create the agreement/requisition', () => withRestoredFetch(async () => {
  const requests = mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'ING_INGDDEFF' })

  assert.equal(result.credential.institutionId, 'ING_INGDDEFF')
  assert.equal(result.credential.institutionSource, 'user-selected')
  const agreementRequest = requests.find((request) => request.url.endsWith('/agreements/enduser/'))
  const requisitionRequest = requests.find((request) => request.url.endsWith('/requisitions/'))
  assert.equal(agreementRequest.body.institution_id, 'ING_INGDDEFF')
  assert.equal(requisitionRequest.body.institution_id, 'ING_INGDDEFF')
}))

test('sends GoCardless our own callback route as the requisition redirect, never the raw client page URL', () => withRestoredFetch(async () => {
  const requests = mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  await adapter.start({ state: 'single-use-state', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'ING_INGDDEFF' })

  const requisitionRequest = requests.find((request) => request.url.endsWith('/requisitions/'))
  const redirect = new URL(requisitionRequest.body.redirect)
  assert.equal(redirect.origin, 'https://finance.example.com')
  assert.equal(redirect.pathname, '/api/connectors/callback')
  assert.equal(redirect.searchParams.get('provider'), 'gocardless')
  assert.equal(redirect.searchParams.get('state'), 'single-use-state')
}))

test('rejects an institution that is not in the live directory instead of guessing or falling through', () => withRestoredFetch(async () => {
  const requests = mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  await assert.rejects(
    adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'SOME_BANK_THE_UI_MADE_UP' }),
    (error) => {
      assert.match(error.message, /not currently available/i)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'invalid_institution')
      return true
    },
  )
  assert.equal(requests.some((request) => request.url.endsWith('/agreements/enduser/')), false, 'must not create an agreement for an unvalidated institution')
  assert.equal(requests.some((request) => request.url.endsWith('/requisitions/')), false, 'must not create a requisition for an unvalidated institution')
}))

test('never silently falls back to institutions[0] when no institution was selected and no override is configured', () => withRestoredFetch(async () => {
  mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  await assert.rejects(
    adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE' }),
    (error) => {
      assert.match(error.message, /Select a bank/i)
      assert.equal(error.status, 400)
      assert.equal(error.code, 'institution_required')
      return true
    },
  )
}))

test('applies the GOCARDLESS_INSTITUTION_ID sandbox override only when no institution was explicitly selected, and validates it too', () => withRestoredFetch(async () => {
  const requests = mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key', GOCARDLESS_INSTITUTION_ID: 'SPARKASSE_AACHEN_AACSDE33' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE' })

  assert.equal(result.credential.institutionId, 'SPARKASSE_AACHEN_AACSDE33')
  assert.equal(result.credential.institutionSource, 'operator-override')
  const requisitionRequest = requests.find((request) => request.url.endsWith('/requisitions/'))
  assert.equal(requisitionRequest.body.institution_id, 'SPARKASSE_AACHEN_AACSDE33')
}))

test('the operator override never silently replaces an explicit user selection', () => withRestoredFetch(async () => {
  const requests = mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key', GOCARDLESS_INSTITUTION_ID: 'SPARKASSE_AACHEN_AACSDE33' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const result = await adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'ING_INGDDEFF' })

  assert.equal(result.credential.institutionId, 'ING_INGDDEFF')
  assert.equal(result.credential.institutionSource, 'user-selected')
  const requisitionRequest = requests.find((request) => request.url.endsWith('/requisitions/'))
  assert.equal(requisitionRequest.body.institution_id, 'ING_INGDDEFF')
}))

test('rejects a stale GOCARDLESS_INSTITUTION_ID override that no longer matches a real institution', () => withRestoredFetch(async () => {
  mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key', GOCARDLESS_INSTITUTION_ID: 'A_DECOMMISSIONED_BANK_ID' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  await assert.rejects(
    adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE' }),
    (error) => {
      assert.match(error.message, /does not match a currently available/i)
      assert.equal(error.status, 503)
      return true
    },
  )
}))

test('the institution directory only exposes sanitized fields to the browser', () => withRestoredFetch(async () => {
  mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  const institutions = await adapter.institutionDirectory('DE')

  assert.deepEqual(institutions, [
    { id: 'SPARKASSE_AACHEN_AACSDE33', name: 'Aachener Sparkasse', bic: 'AACSDE33', logo: 'https://cdn.gocardless.example/aachen.svg' },
    { id: 'ING_INGDDEFF', name: 'ING-DiBa', bic: 'INGDDEFFXXX' },
  ])
  assert.ok(!JSON.stringify(institutions).includes('bank_secret'), 'must not leak unreviewed upstream fields')
}))

test('the institution directory fails closed when GoCardless is not configured', () => withRestoredFetch(async () => {
  mockFetch()
  const adapter = createOpenBankingProviderRegistry({}, fakeBankingCore()).get('gocardless')

  await assert.rejects(
    adapter.institutionDirectory('DE'),
    (error) => {
      assert.equal(error.status, 503)
      assert.equal(error.code, 'provider_not_configured')
      return true
    },
  )
}))

test('the institution directory is cached per country instead of hitting GoCardless on every request', () => withRestoredFetch(async () => {
  const requests = mockFetch()
  const env = { GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }
  const adapter = createOpenBankingProviderRegistry(env, fakeBankingCore()).get('gocardless')

  await adapter.institutionDirectory('DE')
  await adapter.institutionDirectory('DE')
  const institutionListRequests = requests.filter((request) => request.url.includes('/institutions/?country='))
  assert.equal(institutionListRequests.length, 1)
}))
