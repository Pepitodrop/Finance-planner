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

test('asks Enable Banking to end the session and only reports revoked when it confirms', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input, init = {}) => {
    requests.push({ url: String(input), method: init.method || 'GET' })
    return new Response(JSON.stringify({ message: 'OK' }), { status: 200 })
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.disconnect({ sessionId: 'session-1' })

  assert.deepEqual(result, { revoked: true })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'https://api.enablebanking.com/sessions/session-1')
  assert.equal(requests[0].method, 'DELETE')
}))

test('treats an already-gone session (404) as already revoked, not a failure', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).endsWith('/sessions/session-1') && init.method === 'DELETE') return new Response('', { status: 404 })
    throw new Error('Unexpected URL')
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.disconnect({ sessionId: 'session-1' })
  assert.deepEqual(result, { revoked: true })
}))

test('never claims revocation when the provider call fails (network/5xx), and never throws', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => new Response('', { status: 500 })
  const adapter = createOpenBankingProviderRegistry(eligibleEnv({ PROVIDER_RETRIES: '0' }), fakeBankingCore()).get('enablebanking')

  const result = await adapter.disconnect({ sessionId: 'session-1' })
  assert.deepEqual(result, { revoked: false, reason: 'provider_error' })
}))

test('a thrown network error is caught, never propagated, and never reported as a false-positive success', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new TypeError('network unreachable') }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv({ PROVIDER_RETRIES: '0' }), fakeBankingCore()).get('enablebanking')

  const result = await adapter.disconnect({ sessionId: 'session-1' })
  assert.deepEqual(result, { revoked: false, reason: 'provider_error' })
}))

test('with no stored sessionId, reports not_applicable rather than attempting a call', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must not be called') }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.disconnect({})
  assert.deepEqual(result, { revoked: false, reason: 'not_applicable' })
}))

test('with an undefined credential entirely, reports not_applicable rather than throwing', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must not be called') }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.disconnect(undefined)
  assert.deepEqual(result, { revoked: false, reason: 'not_applicable' })
}))
