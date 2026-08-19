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

const ASPSPS = [{ name: 'ING-DiBa', country: 'DE', bic: 'INGDDEFFXXX' }]

function mockAuthFetch({ authUrl = 'https://enablebanking.com/auth/xyz', authorizationId = 'auth-1' } = {}) {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    requests.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers })
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
    if (url.endsWith('/auth')) return new Response(JSON.stringify({ url: authUrl, authorization_id: authorizationId, psu_id_hash: 'hash' }), { status: 200 })
    throw new Error(`Unexpected URL in enable-banking authorization test: ${url}`)
  }
  return requests
}

test('validates a user-selected ASPSP against the live directory and requests read-only access only', () => withRestoredFetch(async () => {
  const requests = mockAuthFetch()
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.start({ state: 'state-1', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'DE:ING-DiBa' })

  const authRequest = requests.find((request) => request.url.endsWith('/auth'))
  assert.equal(authRequest.method, 'POST')
  assert.deepEqual(authRequest.body.aspsp, { name: 'ING-DiBa', country: 'DE' })
  assert.equal(authRequest.body.psu_type, 'personal')
  assert.ok(!('payments' in authRequest.body), 'must never request payment/PIS scope')
  assert.ok(authRequest.body.access?.valid_until, 'must send an access.valid_until')
  assert.equal(result.redirectUrl, 'https://enablebanking.com/auth/xyz')
  assert.equal(result.credential.aspspName, 'ING-DiBa')
  assert.equal(result.credential.aspspCountry, 'DE')
  assert.equal(result.credential.authorizationId, 'auth-1')
}))

test('sends our own callback route as redirect_url, never the raw client page URL, carrying the correct provider and state', () => withRestoredFetch(async () => {
  const requests = mockAuthFetch()
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await adapter.start({ state: 'single-use-state', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'DE:ING-DiBa' })

  const authRequest = requests.find((request) => request.url.endsWith('/auth'))
  const redirect = new URL(authRequest.body.redirect_url)
  assert.equal(redirect.origin, 'https://finance.example.com')
  assert.equal(redirect.pathname, '/api/connectors/callback')
  assert.equal(redirect.searchParams.get('provider'), 'enablebanking')
  assert.equal(redirect.searchParams.get('state'), 'single-use-state')
  assert.equal(authRequest.body.state, 'single-use-state')
}))

test('rejects an institutionId whose ASPSP is not in the live directory, and never calls POST /auth', () => withRestoredFetch(async () => {
  const requests = mockAuthFetch()
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(
    adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'DE:Not A Real Bank' }),
    (error) => error.status === 400 && error.code === 'invalid_institution',
  )
  assert.ok(!requests.some((request) => request.url.endsWith('/auth')))
}))

test('rejects a malformed institutionId (no colon separator) as invalid, never guessing', () => withRestoredFetch(async () => {
  mockAuthFetch()
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(
    adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'not-encoded' }),
    (error) => error.status === 400 && error.code === 'invalid_institution',
  )
}))

test('rejects a missing institutionId with institution_required, never falling through to any default', () => withRestoredFetch(async () => {
  const requests = mockAuthFetch()
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(
    adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE' }),
    (error) => error.status === 400 && error.code === 'institution_required',
  )
  assert.ok(!requests.some((request) => request.url.endsWith('/auth')))
}))

test('caps the requested consent duration at the matched ASPSP\'s maximum_consent_validity when it is lower than the configured default', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: [{ name: 'ING-DiBa', country: 'DE', maximum_consent_validity: 30 }] }), { status: 200 })
    if (url.endsWith('/auth')) {
      const body = JSON.parse(init.body)
      const days = (Date.parse(body.access.valid_until) - Date.now()) / 86_400_000
      assert.ok(days <= 30.01 && days > 29, `expected ~30 days, got ${days}`)
      return new Response(JSON.stringify({ url: 'https://enablebanking.com/auth/xyz', authorization_id: 'a' }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv({ ENABLE_BANKING_CONSENT_DAYS: '90' }), fakeBankingCore()).get('enablebanking')

  await adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'DE:ING-DiBa' })
}))

test('rejects a response missing a usable authorization url', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
    if (url.endsWith('/auth')) return new Response(JSON.stringify({ authorization_id: 'a' }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'DE:ING-DiBa' }), /secure authorization URL/)
}))

test('rejects a non-https authorization url', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/aspsps?country=DE')) return new Response(JSON.stringify({ aspsps: ASPSPS }), { status: 200 })
    if (url.endsWith('/auth')) return new Response(JSON.stringify({ url: 'http://not-secure.example/x', authorization_id: 'a' }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.start({ state: 's', redirectUri: 'https://finance.example.com/connections', country: 'DE', institutionId: 'DE:ING-DiBa' }), /secure authorization URL/)
}))

// --- completeCallback() ---

const PENDING = { aspspName: 'ING-DiBa', aspspCountry: 'DE', authorizationId: 'auth-1', accessValidUntil: '2027-01-01T00:00:00.000000+00:00', consentId: 'consent-1', redirectUri: 'https://finance.example.com/connections' }

test('exchanges a valid authorization code for a session exactly once and merges the result into the pending credential', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), body: init.body ? JSON.parse(init.body) : undefined })
    return new Response(JSON.stringify({
      session_id: 'session-1',
      accounts: [{ uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cash_account_type: 'CACC', identification_hash: 'h' }],
      access: { valid_until: '2027-06-01T00:00:00.000000+00:00' },
    }), { status: 200 })
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const completed = await adapter.completeCallback({ code: 'auth-code-xyz', pending: PENDING })

  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.enablebanking.com/sessions')
  assert.deepEqual(requests[0].body, { code: 'auth-code-xyz' })
  assert.equal(completed.sessionId, 'session-1')
  assert.equal(completed.aspspName, 'ING-DiBa', 'pending fields are preserved')
  assert.equal(completed.accessValidUntil, '2027-06-01T00:00:00.000000+00:00')
  assert.deepEqual(completed.accounts, [{ uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' }])
  assert.ok(completed.authorizedAt)
  assert.ok(!('code' in completed), 'the authorization code must never be persisted')
}))

test('never exposes the authorization code in the returned credential even if a malicious response tries to echo it back', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ session_id: 's', accounts: [], code: 'auth-code-xyz' }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const completed = await adapter.completeCallback({ code: 'auth-code-xyz', pending: PENDING })
  assert.ok(!('code' in completed))
}))

test('an empty accounts array is a legitimate outcome, not an error', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ session_id: 's', accounts: [] }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const completed = await adapter.completeCallback({ code: 'x', pending: PENDING })
  assert.deepEqual(completed.accounts, [])
}))

test('a missing code is treated as the provider denying authorization, distinctly from any other failure, and never calls POST /sessions', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input) => { requests.push(String(input)); throw new Error('must not be called') }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(
    adapter.completeCallback({ code: undefined, pending: PENDING }),
    (error) => error.status === 400 && error.code === 'authorization_denied',
  )
  assert.equal(requests.length, 0)
}))

test('a session exchange failure (network/5xx) throws a generic error, not authorization_denied', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response('', { status: 500 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv({ PROVIDER_RETRIES: '0' }), fakeBankingCore()).get('enablebanking')

  await assert.rejects(
    adapter.completeCallback({ code: 'x', pending: PENDING }),
    (error) => error.code !== 'authorization_denied',
  )
}))

test('a malformed session response (missing session_id) throws', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.completeCallback({ code: 'x', pending: PENDING }), /valid session/)
}))

test('a malformed session response (accounts not an array) throws', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ session_id: 's', accounts: 'not-an-array' }), { status: 200 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.completeCallback({ code: 'x', pending: PENDING }), /valid session/)
}))
