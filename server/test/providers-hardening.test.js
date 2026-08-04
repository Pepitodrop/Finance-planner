import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  createOpenBankingProviderRegistry,
  decimalToCents,
  jsonFetch,
  normalizeProviderAccountType,
  providerAccountTypeAlias,
  retryDelayMs,
  startPayPal,
  syncGoCardless,
  syncWindow,
} from '../src/providers.js'

test('converts provider decimal strings to integer cents without floating-point rounding', () => {
  assert.equal(decimalToCents('12.34'), 1234)
  assert.equal(decimalToCents('-0.01'), -1)
  assert.equal(decimalToCents('100'), 10000)
  assert.equal(decimalToCents('1.2'), 120)
  assert.throws(() => decimalToCents('1.234'))
  assert.throws(() => decimalToCents('NaN'))
})

test('maps provider account codes through the COBOL banking contract', async () => {
  assert.equal(providerAccountTypeAlias({ cashAccountType: 'CACC' }), 'checking')
  assert.equal(providerAccountTypeAlias({ cashAccountType: 'SVGS' }), 'savings')
  assert.equal(providerAccountTypeAlias({ cashAccountType: 'CARD' }), 'credit-card')
  assert.equal(providerAccountTypeAlias({ cashAccountType: 'CASH' }), 'cash')
  assert.equal(providerAccountTypeAlias({ cashAccountType: 'TRAS' }), 'investment')
  assert.equal(providerAccountTypeAlias({ cashAccountType: 'unknown-provider-value' }), 'checking')

  const calls = []
  const fakeCore = {
    async normalizeProviderAccountType(value) {
      calls.push(value)
      return 'savings'
    },
  }
  assert.equal(await normalizeProviderAccountType({ cashAccountType: 'SVGS' }, {}, fakeCore), 'savings')
  assert.deepEqual(calls, ['SVGS'])
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

test('rejects expired or revoked GoCardless consent through COBOL policy before account synchronization', async () => {
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

test('PayPal owner mode connects the application account without partner onboarding', async () => {
  const common = {
    state: 'single-use-state',
    redirectUri: 'https://finance.example.com/connections',
  }

  const started = await startPayPal({
    ...common,
    env: {
      PAYPAL_CLIENT_ID: 'client',
      PAYPAL_CLIENT_SECRET: 'secret',
      PAYPAL_CONNECTION_MODE: 'owner',
      PAYPAL_ENV: 'live',
    },
  })
  const redirect = new URL(started.redirectUrl)
  assert.equal(redirect.origin, 'https://finance.example.com')
  assert.equal(redirect.pathname, '/api/connectors/callback')
  assert.equal(redirect.searchParams.get('provider'), 'paypal')
  assert.equal(redirect.searchParams.get('state'), common.state)
  assert.equal(started.credential.mode, 'owner')
})

test('PayPal partner mode still fails closed without approved partner onboarding', async () => {
  const common = {
    state: 'single-use-state',
    redirectUri: 'https://finance.example.com/connections/paypal/callback',
  }

  await assert.rejects(
    startPayPal({
      ...common,
      env: {
        PAYPAL_CLIENT_ID: 'client',
        PAYPAL_CLIENT_SECRET: 'secret',
        PAYPAL_CONNECTION_MODE: 'partner',
        PAYPAL_ENV: 'live',
      },
    }),
    /partner onboarding is not configured/,
  )

  const started = await startPayPal({
    ...common,
    env: {
      PAYPAL_CLIENT_ID: 'client',
      PAYPAL_CLIENT_SECRET: 'secret',
      PAYPAL_CONNECTION_MODE: 'partner',
      PAYPAL_PARTNER_MERCHANT_ID: 'partner-merchant',
      PAYPAL_ENV: 'live',
    },
  })
  const redirect = new URL(started.redirectUrl)
  assert.equal(redirect.hostname, 'www.paypal.com')
  assert.equal(redirect.pathname, '/bizsignup/partner/entry')
  assert.equal(started.credential.mode, 'partner')
})

test('generic provider registry exposes replaceable read-only adapters only', () => {
  const fakeCore = {
    async validateReadOnlyScope() { return true },
    async validateProviderConsent() { return 'ready' },
    async normalizeProviderAccountType() { return 'checking' },
    async normalizeProviderAmount() { return 0 },
  }
  const registry = createOpenBankingProviderRegistry({
    GOCARDLESS_SECRET_ID: 'id',
    GOCARDLESS_SECRET_KEY: 'key',
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_CONNECTION_MODE: 'owner',
  }, fakeCore)
  const providers = registry.list()
  assert.deepEqual(providers.map((provider) => provider.id), ['gocardless', 'paypal', 'finapi'])
  for (const provider of providers) {
    assert.equal(provider.capabilities.paymentInitiation, false)
    assert.equal(provider.capabilities.transfers, false)
    assert.equal(provider.capabilities.payouts, false)
    assert.equal(provider.capabilities.orders, false)
  }
  assert.deepEqual(registry.configured().map((provider) => provider.id), ['gocardless', 'paypal'])
})

test('bank connectors enforce consent, read-only scope, pagination and reconciliation controls', async () => {
  const source = await readFile(new URL('../src/providers.js', import.meta.url), 'utf8')
  assert.match(source, /OpenBankingProviderRegistry/)
  assert.match(source, /validateReadOnlyScope/)
  assert.match(source, /paymentInitiation: false/)
  assert.match(source, /\/v1\/reporting\/transactions/)
  assert.doesNotMatch(source, /\/v2\/checkout\/orders/)
  assert.doesNotMatch(source, /\/v1\/payments/)
  assert.doesNotMatch(source, /\/v1\/payments\/payouts/)
  assert.match(source, /MAX_PAYPAL_PAGES/)
  assert.match(source, /validateProviderReconciliation/)
  assert.match(source, /normalizeProviderAccountType/)
})
