import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { decimalToCents, jsonFetch, syncGoCardless } from '../src/providers.js'

test('converts provider decimal strings to integer cents without floating-point rounding', () => {
  assert.equal(decimalToCents('12.34'), 1234)
  assert.equal(decimalToCents('-0.01'), -1)
  assert.equal(decimalToCents('100'), 10000)
  assert.equal(decimalToCents('1.2'), 120)
  assert.throws(() => decimalToCents('1.234'))
  assert.throws(() => decimalToCents('NaN'))
})

test('retries retryable provider responses before succeeding', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    if (calls === 1) return new Response(JSON.stringify({ detail: 'temporary outage' }), { status: 503 })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }

  try {
    const result = await jsonFetch('https://provider.invalid/test', {}, { retries: 1, timeoutMs: 1_000 })
    assert.deepEqual(result, { ok: true })
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects expired GoCardless consent before account synchronization', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'EX', accounts: ['account-1'] }), { status: 200 })

  try {
    await assert.rejects(
      syncGoCardless({ requisitionId: 'req-1', token: { access: 'token' } }, { PROVIDER_RETRIES: '0' }),
      /GoCardless consent is not ready: EX/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('bank connectors enforce timeout, retry, consent, pagination and reconciliation controls', async () => {
  const source = await readFile(new URL('../src/providers.js', import.meta.url), 'utf8')
  assert.match(source, /AbortController/)
  assert.match(source, /response\.status === 429 \|\| response\.status >= 500/)
  assert.match(source, /requisition\.status !== 'LN'/)
  assert.match(source, /seen\.has\(externalId\)/)
  assert.match(source, /url\.searchParams\.set\('page'/)
  assert.match(source, /page <= 100/)
  assert.match(source, /reconciliation:/)
})
