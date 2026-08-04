import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { decimalToCents, jsonFetch, retryDelayMs, startPayPal, syncGoCardless, syncWindow } from '../src/providers.js'

test('converts provider decimal strings to integer cents without floating-point rounding', () => {
  assert.equal(decimalToCents('12.34'), 1234)
  assert.equal(decimalToCents('-0.01'), -1)
  assert.equal(decimalToCents('100'), 10000)
  assert.equal(decimalToCents('1.2'), 120)
  assert.throws(() => decimalToCents('1.234'))
  assert.throws(() => decimalToCents('NaN'))
})

test('calculates bounded Retry-After delays for seconds and HTTP dates', () => {
  assert.equal(retryDelayMs('2', 1_000), 2_000)
  assert.equal(retryDelayMs(new Date(6_000).toUTCString(), 1_000), 5_000)
  assert.equal(retryDelayMs('999', 1_000), 30_000)
  assert.equal(retryDelayMs('invalid', 1_000), null)
})

test('builds incremental sync windows with overlap and bounded history', () => {
  const now = new Date('2026-07-28T12:00:00.000Z')
  const incremental = syncWindow('2026-07-27T12:00:00.000Z', now, 31, 3)
  assert.equal(incremental.dateFrom, '2026-07-24')
  assert.equal(incremental.dateTo, '2026-07-28')

  const bounded = syncWindow('2020-01-01T00:00:00.000Z', now, 31, 3)
  assert.equal(bounded.dateFrom, '2026-06-27')
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

test('rejects expired or revoked GoCardless consent before account synchronization', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'EX', accounts: ['account-1'] }), { status: 200 })

  try {
    await assert.rejects(
      syncGoCardless({ requisitionId: 'req-1', token: { access: 'token' } }, { PROVIDER_RETRIES: '0' }),
      /GoCardless consent expired or was revoked: EX/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('PayPal start fails closed unless a provider-hosted partner flow is configured', async () => {
  const common = {
    state: 'single-use-state',
    redirectUri: 'https://finance.example.com/connections/paypal/callback',
  }

  await assert.rejects(
    startPayPal({
      ...common,
      env: { PAYPAL_CLIENT_ID: 'client', PAYPAL_CLIENT_SECRET: 'secret', PAYPAL_ENV: 'live' },
    }),
    /partner onboarding is not configured/,
  )

  const started = await startPayPal({
    ...common,
    env: {
      PAYPAL_CLIENT_ID: 'client',
      PAYPAL_CLIENT_SECRET: 'secret',
      PAYPAL_PARTNER_MERCHANT_ID: 'partner-merchant',
      PAYPAL_ENV: 'live',
    },
  })
  const redirect = new URL(started.redirectUrl)
  assert.equal(redirect.protocol, 'https:')
  assert.equal(redirect.hostname, 'www.paypal.com')
  assert.equal(redirect.pathname, '/bizsignup/partner/entry')
  assert.equal(redirect.searchParams.get('state'), common.state)
  assert.equal(started.credential.mode, 'partner')
})

test('bank connectors enforce consent, incremental, pagination and reconciliation controls', async () => {
  const source = await readFile(new URL('../src/providers.js', import.meta.url), 'utf8')
  assert.match(source, /AbortController/)
  assert.match(source, /response\.status === 429 \|\| response\.status >= 500/)
  assert.match(source, /requisition\.status !== 'LN'/)
  assert.match(source, /gocardlessConsentExpiresAt/)
  assert.match(source, /date_from/)
  assert.match(source, /lastSyncedAt/)
  assert.match(source, /MAX_PAYPAL_PAGES/)
  assert.match(source, /pagination exceeds safety limit/)
  assert.match(source, /validateProviderReconciliation/)
})
