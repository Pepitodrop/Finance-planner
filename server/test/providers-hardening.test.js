import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  createOpenBankingProviderRegistry,
  jsonFetch,
  normalizeProviderAccountType,
  retryDelayMs,
  startPayPal,
  syncGoCardless,
  syncPayPal,
  syncWindow,
} from '../src/providers.js'

function fakeBankingCore() {
  return {
    async validateReadOnlyScope() { return true },
    async validateProviderConsent() { return 'ready' },
    async normalizeProviderAccountType(value) { return value === 'CASH' ? 'cash' : 'checking' },
    async normalizeProviderAmount(value) {
      const values = { '123.45': 12_345, '5.00': 500, '-2.50': -250 }
      if (!(String(value) in values)) throw new Error(`Unexpected test amount: ${value}`)
      return values[String(value)]
    },
  }
}

test('maps provider account codes only through the COBOL banking contract', async () => {
  const calls = []
  const core = {
    async normalizeProviderAccountType(value) {
      calls.push(value)
      return 'savings'
    },
  }
  assert.equal(await normalizeProviderAccountType({ cashAccountType: 'SVGS' }, {}, core), 'savings')
  assert.deepEqual(calls, ['SVGS'])
  await assert.rejects(normalizeProviderAccountType({ cashAccountType: 'SVGS' }, {}, {}), /COBOL banking core/)
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

test('provider errors do not expose upstream response bodies', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: 'secret upstream body' }), { status: 400 })
  try {
    await assert.rejects(
      jsonFetch('https://provider.invalid/test', {}, { retries: 0, timeoutMs: 1_000 }),
      (error) => /HTTP 400/.test(error.message) && !/secret upstream body/.test(error.message),
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('rejects expired or revoked GoCardless consent through COBOL policy before account synchronization', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'EX', accounts: ['account-1'] }), { status: 200 })
  const core = { async validateProviderConsent() { return 'expired' } }

  try {
    await assert.rejects(
      syncGoCardless({ requisitionId: 'req-1', token: { access: 'token' } }, { PROVIDER_RETRIES: '0' }, core),
      /GoCardless consent expired or was revoked: EX/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('PayPal owner mode verifies reporting access without partner onboarding', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 })
    if (url.includes('/v1/reporting/balances')) {
      return new Response(JSON.stringify({
        account_id: 'PAYPALACCOUNT',
        balances: [{ currency: 'EUR', total_balance: { currency_code: 'EUR', value: '123.45' } }],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const common = {
      state: 'single-use-state',
      redirectUri: 'https://finance.example.com/connections',
    }
    const started = await startPayPal({
      ...common,
      core: fakeBankingCore(),
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
    assert.ok(requests.some((url) => url.includes('/v1/reporting/balances')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('PayPal synchronization uses the reporting balance instead of summing the sync window', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/v1/oauth2/token')) return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 })
    if (url.includes('/v1/reporting/balances')) {
      return new Response(JSON.stringify({
        account_id: 'PAYPALACCOUNT',
        as_of_time: '2026-08-04T18:00:00Z',
        balances: [{ currency: 'EUR', total_balance: { currency_code: 'EUR', value: '123.45' } }],
      }), { status: 200 })
    }
    if (url.includes('/v1/reporting/transactions')) {
      return new Response(JSON.stringify({
        total_pages: 1,
        transaction_details: [{
          transaction_info: {
            transaction_id: 'TX-1',
            transaction_event_code: 'T0001',
            transaction_status: 'S',
            transaction_subject: 'Test transaction',
            transaction_initiation_date: '2026-08-03T10:00:00Z',
            transaction_amount: { currency_code: 'EUR', value: '5.00' },
          },
        }],
      }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    const env = {
      PAYPAL_CLIENT_ID: 'client',
      PAYPAL_CLIENT_SECRET: 'secret',
      PAYPAL_CONNECTION_MODE: 'owner',
      PAYPAL_ENV: 'live',
      PROVIDER_RETRIES: '0',
      ALLOW_JS_FINANCE_FALLBACK: 'true',
      NODE_ENV: 'test',
    }
    const synced = await syncPayPal({ mode: 'owner' }, env, fakeBankingCore())
    assert.equal(synced.accounts[0].balanceCents, 12_345)
    assert.equal(synced.transactions[0].amountCents, 500)
    const transactionUrl = new URL(requests.find((url) => url.includes('/v1/reporting/transactions')))
    assert.equal(transactionUrl.searchParams.get('fields'), 'transaction_info')
    assert.equal(transactionUrl.searchParams.get('balance_affecting_records_only'), 'Y')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('PayPal partner mode still fails closed without approved partner onboarding', async () => {
  const common = {
    state: 'single-use-state',
    redirectUri: 'https://finance.example.com/connections/paypal/callback',
    core: fakeBankingCore(),
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
  const registry = createOpenBankingProviderRegistry({
    GOCARDLESS_SECRET_ID: 'id',
    GOCARDLESS_SECRET_KEY: 'key',
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_CONNECTION_MODE: 'owner',
  }, fakeBankingCore())
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

test('server dispatches connector lifecycle through the generic registry', async () => {
  const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8')
  assert.match(serverSource, /createOpenBankingProviderRegistry/)
  assert.match(serverSource, /providerRegistry\.get/)
  assert.match(serverSource, /providerRegistry\.list/)
  assert.doesNotMatch(serverSource, /provider === 'gocardless'/)
  assert.doesNotMatch(serverSource, /provider === 'paypal'/)
})

test('bank connectors enforce consent, minimal reporting fields and no payment APIs', async () => {
  const source = await readFile(new URL('../src/providers.js', import.meta.url), 'utf8')
  assert.match(source, /OpenBankingProviderRegistry/)
  assert.match(source, /validateReadOnlyScope/)
  assert.match(source, /paymentInitiation: false/)
  assert.match(source, /\/v1\/reporting\/transactions/)
  assert.match(source, /\/v1\/reporting\/balances/)
  assert.match(source, /fields', 'transaction_info'/)
  assert.doesNotMatch(source, /fields', 'all'/)
  assert.doesNotMatch(source, /\/v2\/checkout\/orders/)
  assert.doesNotMatch(source, /\/v1\/payments/)
  assert.doesNotMatch(source, /\/v1\/payments\/payouts/)
  assert.match(source, /MAX_PAYPAL_PAGES/)
  assert.match(source, /validateProviderReconciliation/)
  assert.match(source, /normalizeProviderAccountType/)
})
