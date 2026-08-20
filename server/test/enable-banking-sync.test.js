import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'
import { createOpenBankingProviderRegistry } from '../src/providers.js'

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })

function fakeBankingCore(reconciliationCalls = []) {
  return {
    async validateReadOnlyScope() { return true },
    async validateProviderConsent(provider, status) {
      if (['ACTIVE', 'AUTHORIZED', 'READY'].includes(status)) return 'ready'
      if (['EXPIRED', 'REVOKED', 'REJECTED'].includes(status)) return 'expired'
      return 'pending'
    },
    async validateProviderReconciliation(input) { reconciliationCalls.push(input); return true },
    async normalizeProviderAccountType(value) { return value === 'CACC' ? 'checking' : 'checking' },
    async normalizeProviderAmount(value) { return Math.round(Number(value) * 100) },
  }
}

function eligibleEnv(overrides = {}) {
  // normalizeSignedAmount() (server/src/cobol-engine.js) shells out to the
  // compiled COBOL binary directly, bypassing the injectable fakeBankingCore
  // -- this sandbox has no libcob.so.4, so sync() tests that reach real
  // transaction amounts need the same JS-side fallback PayPal's own sync
  // tests already use (providers-hardening.test.js). A real GnuCOBOL-equipped
  // environment exercises the authoritative binary instead; this flag never
  // applies in production (NODE_ENV check in cobol-engine.js).
  return { ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey, ALLOW_JS_FINANCE_FALLBACK: 'true', NODE_ENV: 'test', ...overrides }
}

function withRestoredFetch(run) {
  const originalFetch = globalThis.fetch
  return run().finally(() => { globalThis.fetch = originalFetch })
}

const CREDENTIAL = {
  sessionId: 'session-1',
  aspspName: 'ING-DiBa',
  aspspCountry: 'DE',
  accessValidUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  accounts: [{ uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' }],
}

function balancesResponse(amount = '1234.56') {
  return { balances: [{ balance_amount: { currency: 'EUR', amount }, balance_type: 'CLBD' }] }
}

test('checks session status before syncing and proceeds when AUTHORIZED', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url === 'https://api.enablebanking.com/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse()), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)

  assert.ok(requests.includes('https://api.enablebanking.com/sessions/session-1'))
  assert.equal(result.accounts.length, 1)
  assert.equal(result.accounts[0].balanceCents, 123_456)
}))

test('throws when the session status has expired, and never fetches balances/transactions', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'EXPIRED' }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /consent expired/)
  assert.equal(requests.length, 1)
}))

test('throws when the locally stored accessValidUntil has already passed, without even checking the live session', () => withRestoredFetch(async () => {
  globalThis.fetch = async () => { throw new Error('must not be called') }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync({ ...CREDENTIAL, accessValidUntil: new Date(Date.now() - 1000).toISOString() }), /consent expired/)
}))

test('syncs balances and transactions for multiple accounts', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [
    { uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' },
    { uid: 'acct-2', name: 'Tagesgeld', currency: 'EUR', cashAccountType: 'SVGS' },
  ] }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('acct-1/balances')) return new Response(JSON.stringify(balancesResponse('100.00')), { status: 200 })
    if (url.includes('acct-2/balances')) return new Response(JSON.stringify(balancesResponse('500.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(credential)

  assert.equal(result.accounts.length, 2)
  assert.deepEqual(result.accounts.map((a) => a.balanceCents), [10_000, 50_000])
}))

test('refreshes the account list and consent expiry from the live session response, not the frozen credential', () => withRestoredFetch(async () => {
  const staleCredential = { ...CREDENTIAL, accounts: [{ uid: 'stale-acct', name: 'Stale', currency: 'EUR', cashAccountType: 'CACC' }] }
  const freshValidUntil = new Date(Date.now() + 60 * 86_400_000).toISOString()
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({
      status: 'AUTHORIZED',
      accounts: [{ uid: 'fresh-acct', name: 'Fresh Account', currency: 'EUR', cash_account_type: 'CACC' }],
      access: { valid_until: freshValidUntil },
    }), { status: 200 })
    if (url.includes('fresh-acct/balances')) return new Response(JSON.stringify(balancesResponse('42.00')), { status: 200 })
    if (url.includes('fresh-acct/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(staleCredential)

  assert.equal(result.accounts.length, 1)
  assert.equal(result.accounts[0].externalId, 'fresh-acct')
  assert.equal(result.consentExpiresAt, freshValidUntil)
  assert.equal(result.credential.accounts[0].uid, 'fresh-acct')
  assert.equal(result.credential.consentExpiresAt, freshValidUntil)
}))

test('falls back to the credential\'s stored accounts and expiry when the live session response omits them', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('acct-1/balances')) return new Response(JSON.stringify(balancesResponse('10.00')), { status: 200 })
    if (url.includes('acct-1/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)

  assert.equal(result.accounts.length, 1)
  assert.equal(result.accounts[0].externalId, 'acct-1')
  assert.equal(result.consentExpiresAt, CREDENTIAL.accessValidUntil)
}))

test('prefers CLBD over CLAV over any other EUR balance type when multiple are present', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify({ balances: [
      { balance_amount: { currency: 'EUR', amount: '1.00' }, balance_type: 'FWAV' },
      { balance_amount: { currency: 'EUR', amount: '2.00' }, balance_type: 'CLAV' },
      { balance_amount: { currency: 'EUR', amount: '3.00' }, balance_type: 'CLBD' },
    ] }), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.accounts[0].balanceCents, 300)
}))

test('defaults to a zero balance (never throws) when no EUR balance is present at all', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify({ balances: [{ balance_amount: { currency: 'USD', amount: '9.00' }, balance_type: 'CLBD' }] }), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.accounts[0].balanceCents, 0)
}))

test('a malformed balance response (balances not an array) throws a clean domain error, not a raw TypeError', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify({ balances: { amount: '1.00' } }), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /balance response is invalid/)
}))

test('a missing balances field entirely also throws the same clean domain error', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify({}), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /balance response is invalid/)
}))

test('maps booked and pending transactions from the BOOK/PEND status field', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { transaction_id: 'tx-booked', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: ['Rent'] },
      { transaction_id: 'tx-pending', status: 'PEND', transaction_amount: { currency: 'EUR', amount: '5.00' }, booking_date: '2026-08-02', remittance_information: ['Coffee'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  const booked = result.transactions.find((t) => t.externalId === 'tx-booked')
  const pending = result.transactions.find((t) => t.externalId === 'tx-pending')
  assert.equal(booked.pending, false)
  assert.equal(pending.pending, true)
}))

test('follows continuation_key pagination, keeping date_from/date_to identical across pages', () => withRestoredFetch(async () => {
  const transactionRequests = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      transactionRequests.push({ dateFrom: url.searchParams.get('date_from'), dateTo: url.searchParams.get('date_to'), continuationKey: url.searchParams.get('continuation_key') })
      if (!url.searchParams.get('continuation_key')) {
        return new Response(JSON.stringify({ transactions: [{ transaction_id: 'tx-1', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }], continuation_key: 'page-2-key' }), { status: 200 })
      }
      assert.equal(url.searchParams.get('continuation_key'), 'page-2-key')
      return new Response(JSON.stringify({ transactions: [{ transaction_id: 'tx-2', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '2.00' }, booking_date: '2026-08-02', remittance_information: [] }] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)

  assert.equal(transactionRequests.length, 2)
  assert.equal(transactionRequests[0].dateFrom, transactionRequests[1].dateFrom)
  assert.equal(transactionRequests[0].dateTo, transactionRequests[1].dateTo)
  assert.equal(transactionRequests[0].continuationKey, null)
  assert.equal(transactionRequests[1].continuationKey, 'page-2-key')
  assert.deepEqual(result.transactions.map((t) => t.externalId).sort(), ['tx-1', 'tx-2'])
}))

test('continues past an empty page as long as continuation_key is still present', () => withRestoredFetch(async () => {
  let pageCount = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      pageCount += 1
      if (pageCount === 1) return new Response(JSON.stringify({ transactions: [], continuation_key: 'still-more' }), { status: 200 })
      return new Response(JSON.stringify({ transactions: [{ transaction_id: 'tx-final', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(pageCount, 2)
  assert.deepEqual(result.transactions.map((t) => t.externalId), ['tx-final'])
}))

test('stops as soon as continuation_key is absent, even on the first page', () => withRestoredFetch(async () => {
  let pageCount = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) { pageCount += 1; return new Response(JSON.stringify({ transactions: [] }), { status: 200 }) }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await adapter.sync(CREDENTIAL)
  assert.equal(pageCount, 1)
}))

test('a provider-controlled continuation_key that never terminates is bounded by a pagination safety limit', () => withRestoredFetch(async () => {
  let pageCount = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) { pageCount += 1; return new Response(JSON.stringify({ transactions: [], continuation_key: `key-${pageCount}` }), { status: 200 }) }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /pagination exceeds safety limit/)
  assert.ok(pageCount <= 101, `pagination must be bounded, got ${pageCount} pages`)
}))

test('deduplicates transactions by transaction_id across pages', () => withRestoredFetch(async () => {
  let requested = false
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      if (!requested) {
        requested = true
        return new Response(JSON.stringify({ transactions: [{ transaction_id: 'dup-1', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }], continuation_key: 'k' }), { status: 200 })
      }
      return new Response(JSON.stringify({ transactions: [{ transaction_id: 'dup-1', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.transactions.length, 1)
}))

test('filters out non-EUR transactions, matching existing Finance Planner provider policy', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { transaction_id: 'eur-1', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] },
      { transaction_id: 'usd-1', status: 'BOOK', transaction_amount: { currency: 'USD', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.deepEqual(result.transactions.map((t) => t.externalId), ['eur-1'])
}))

test('validates the sync payload through the COBOL reconciliation boundary before returning', () => withRestoredFetch(async () => {
  const reconciliationCalls = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore(reconciliationCalls)).get('enablebanking')

  await adapter.sync(CREDENTIAL)
  assert.equal(reconciliationCalls.length, 1)
  assert.equal(reconciliationCalls[0].accountCount, 1)
}))

test('rejects a session status of an unrecognized shape by treating it as pending, not ready', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'SOMETHING_UNEXPECTED' }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /consent is not ready/)
}))
