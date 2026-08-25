import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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

// lastSyncedAt is set so this shared fixture represents a routine,
// already-connected-for-a-while sync (the common case, and what most tests
// below actually mean to exercise) -- NOT the first sync after
// authorization, which now uses a different transaction-request strategy
// (see the dedicated "first sync" tests further down, which explicitly
// build a credential with lastSyncedAt omitted).
const CREDENTIAL = {
  sessionId: 'session-1',
  aspspName: 'ING-DiBa',
  aspspCountry: 'DE',
  accessValidUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  lastSyncedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
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

// GET /sessions/{id}.accounts is documented as an array of bare account-id
// STRINGS, not AccountResource objects -- this fixture now matches that
// real shape. 'fresh-acct' isn't in staleCredential's stored accounts, so
// this also exercises the GET /accounts/{id}/details fallback for a
// genuinely new account the live session exposes.
test('refreshes the account list and consent expiry from the live session response, not the frozen credential', () => withRestoredFetch(async () => {
  const staleCredential = { ...CREDENTIAL, accounts: [{ uid: 'stale-acct', name: 'Stale', currency: 'EUR', cashAccountType: 'CACC' }] }
  const freshValidUntil = new Date(Date.now() + 60 * 86_400_000).toISOString()
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({
      status: 'AUTHORIZED',
      accounts: ['fresh-acct'],
      access: { valid_until: freshValidUntil },
    }), { status: 200 })
    if (url.endsWith('/accounts/fresh-acct/details')) return new Response(JSON.stringify({ uid: 'fresh-acct', name: 'Fresh Account', currency: 'EUR', cash_account_type: 'CACC' }), { status: 200 })
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

// Regression coverage (2026-08-22, found during Mock ASPSP sandbox prep):
// the current official Enable Banking status enum is BOOK (booked) / PDNG
// (pending) -- 'PEND' is not a real value this API uses. The previous code
// compared against 'PEND', so every transaction was silently imported as
// booked (pending: false) regardless of its real status.
test('maps booked and pending transactions from the BOOK/PDNG status field (6, 7)', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'entry-booked', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: ['Rent'] },
      { entry_reference: 'entry-pending', status: 'PDNG', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '5.00' }, booking_date: '2026-08-02', remittance_information: ['Coffee'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  const booked = result.transactions.find((t) => t.externalId === 'acct-1:entry-booked')
  const pending = result.transactions.find((t) => t.externalId === 'acct-1:entry-pending')
  assert.equal(booked.pending, false)
  assert.equal(pending.pending, true)
}))

// Found by PR #154 review (2026-08-25): the current official Enable Banking
// transaction-status enum has seven values -- BOOK, PDNG, CNCL, HOLD, OTHR,
// RJCT, SCHD -- but the mapping above only ever checked for PDNG, so
// CNCL/HOLD/OTHR/RJCT/SCHD all silently became `pending: false` and were
// imported as ordinary booked transactions. Only BOOK/PDNG should ever
// reach the imported set; the rest have no correct booked-or-pending
// mapping in Finance Planner's model (no cancelled/held/scheduled/other
// category exists) and must be skipped outright -- never coerced to
// booked, never guessed at.
function transactionFixture(overrides) {
  return { entry_reference: 'entry', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [], ...overrides }
}

test('every documented status is handled correctly: only BOOK/PDNG are imported, CNCL/HOLD/OTHR/RJCT/SCHD are skipped, none of them ever become booked', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      transactionFixture({ entry_reference: 'entry-book', status: 'BOOK' }),
      transactionFixture({ entry_reference: 'entry-pdng', status: 'PDNG' }),
      transactionFixture({ entry_reference: 'entry-cncl', status: 'CNCL' }),
      transactionFixture({ entry_reference: 'entry-hold', status: 'HOLD' }),
      transactionFixture({ entry_reference: 'entry-othr', status: 'OTHR' }),
      transactionFixture({ entry_reference: 'entry-rjct', status: 'RJCT' }),
      transactionFixture({ entry_reference: 'entry-schd', status: 'SCHD' }),
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)

  // Exactly the two real transactions are imported -- the other five never
  // enter the transactions array at all, booked or otherwise.
  assert.deepEqual(result.transactions.map((t) => t.externalId).sort(), ['acct-1:entry-book', 'acct-1:entry-pdng'])
  const booked = result.transactions.find((t) => t.externalId === 'acct-1:entry-book')
  const pending = result.transactions.find((t) => t.externalId === 'acct-1:entry-pdng')
  assert.equal(booked.pending, false)
  assert.equal(pending.pending, true)
  // Prove none of the excluded statuses leaked in under a booked (or any) row.
  for (const excluded of ['entry-cncl', 'entry-hold', 'entry-othr', 'entry-rjct', 'entry-schd']) {
    assert.equal(result.transactions.some((t) => t.externalId === `acct-1:${excluded}`), false)
  }
}))

test('fails closed on a transaction status outside the documented enum, rather than guessing or defaulting to booked', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      transactionFixture({ entry_reference: 'entry-unknown', status: 'WEIRD' }),
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /unrecognized status/)
}))

test('fails closed on a transaction with no status field at all', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      transactionFixture({ entry_reference: 'entry-missing', status: undefined }),
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /unrecognized status/)
}))

test('follows continuation_key pagination, keeping date_from/date_to identical across pages (10)', () => withRestoredFetch(async () => {
  const transactionRequests = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      transactionRequests.push({ dateFrom: url.searchParams.get('date_from'), dateTo: url.searchParams.get('date_to'), continuationKey: url.searchParams.get('continuation_key') })
      if (!url.searchParams.get('continuation_key')) {
        return new Response(JSON.stringify({ transactions: [{ entry_reference: 'entry-1', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }], continuation_key: 'page-2-key' }), { status: 200 })
      }
      assert.equal(url.searchParams.get('continuation_key'), 'page-2-key')
      return new Response(JSON.stringify({ transactions: [{ entry_reference: 'entry-2', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '2.00' }, booking_date: '2026-08-02', remittance_information: [] }] }), { status: 200 })
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
  assert.deepEqual(result.transactions.map((t) => t.externalId).sort(), ['acct-1:entry-1', 'acct-1:entry-2'])
}))

test('continues past an empty page as long as continuation_key is still present (10)', () => withRestoredFetch(async () => {
  let pageCount = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      pageCount += 1
      if (pageCount === 1) return new Response(JSON.stringify({ transactions: [], continuation_key: 'still-more' }), { status: 200 })
      return new Response(JSON.stringify({ transactions: [{ entry_reference: 'entry-final', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(pageCount, 2)
  assert.deepEqual(result.transactions.map((t) => t.externalId), ['acct-1:entry-final'])
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

test('deduplicates transactions by entry_reference across pages (namespaced by account.uid)', () => withRestoredFetch(async () => {
  let requested = false
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      if (!requested) {
        requested = true
        return new Response(JSON.stringify({ transactions: [{ entry_reference: 'dup-1', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }], continuation_key: 'k' }), { status: 200 })
      }
      return new Response(JSON.stringify({ transactions: [{ entry_reference: 'dup-1', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.transactions.length, 1)
}))

// 9. Non-EUR items are filtered out BEFORE the credit_debit_indicator check
// even runs -- the USD row below deliberately carries no indicator at all,
// proving the currency filter still short-circuits first exactly as before
// this pass's sign/identifier/status changes.
test('filters out non-EUR transactions, matching existing Finance Planner provider policy (9)', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'eur-1', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] },
      { entry_reference: 'usd-1', status: 'BOOK', transaction_amount: { currency: 'USD', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.deepEqual(result.transactions.map((t) => t.externalId), ['acct-1:eur-1'])
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

// Regression suite for the three provider-contract bugs found during Mock
// ASPSP sandbox prep (2026-08-22), confirmed against the current official
// Enable Banking account-information API reference:
//   1. transaction_amount.amount is ABSOLUTE; credit_debit_indicator (CRDT/
//      DBIT) determines sign -- the old code treated the absolute value as
//      already signed, silently importing every transaction as income.
//   2. entry_reference (not transaction_id) is the documented ASPSP
//      transaction identifier, scoped per-account.
//   3. PDNG (not PEND) is the documented pending status value.

test('1. CRDT 10.00 EUR normalizes to +1000 cents', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'salary', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: ['Salary'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.transactions[0].amountCents, 1000)
}))

test('2. DBIT 10.00 EUR normalizes to -1000 cents', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'rewe', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: ['REWE'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.transactions[0].amountCents, -1000)
}))

test('3. entry_reference is used as the stable transaction identity, namespaced by account.uid', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'ref-123', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.transactions[0].externalId, 'acct-1:ref-123')
}))

test('4. no entry_reference falls back to the deterministic account/date/amount/description key', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { currency: 'EUR', amount: '49.99' }, booking_date: '2026-08-03', remittance_information: ['Internet'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.equal(result.transactions[0].externalId, 'acct-1:2026-08-03:49.99:Internet')
  assert.equal(result.transactions[0].amountCents, -4999)
}))

test('5. the same entry_reference on two different accounts produces two distinct, non-colliding transactions', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [
    { uid: 'acct-a', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' },
    { uid: 'acct-b', name: 'Tagesgeld', currency: 'EUR', cashAccountType: 'SVGS' },
  ] }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('acct-a/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'shared-ref', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: ['Account A'] },
    ] }), { status: 200 })
    if (url.includes('acct-b/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'shared-ref', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: ['Account B'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(credential)
  // Both must survive -- if entry_reference were used bare (not namespaced
  // by account.uid), the shared `seen` Set would treat the second as a
  // duplicate of the first and silently drop it, corrupting account B's
  // transaction history with account A's.
  assert.equal(result.transactions.length, 2)
  const onA = result.transactions.find((t) => t.externalAccountId === 'acct-a')
  const onB = result.transactions.find((t) => t.externalAccountId === 'acct-b')
  assert.equal(onA.externalId, 'acct-a:shared-ref')
  assert.equal(onB.externalId, 'acct-b:shared-ref')
  assert.equal(onA.amountCents, 1000)
  assert.equal(onB.amountCents, -1000)
}))

test('8. an unrecognized credit_debit_indicator fails closed instead of silently becoming positive income', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'weird', status: 'BOOK', credit_debit_indicator: 'XYZZ', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: [] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /unrecognized credit_debit_indicator/)
}))

test('8b. a missing credit_debit_indicator entirely also fails closed', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'no-indicator', status: 'BOOK', transaction_amount: { currency: 'EUR', amount: '10.00' }, booking_date: '2026-08-01', remittance_information: [] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(CREDENTIAL), /unrecognized credit_debit_indicator/)
}))

test('11. reconciliation still receives correctly signed values across a mixed CRDT/DBIT set', () => withRestoredFetch(async () => {
  const reconciliationCalls = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify(balancesResponse('6959.50')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [
      { entry_reference: 'salary', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '2500.00' }, booking_date: '2026-08-01', remittance_information: ['Salary'] },
      { entry_reference: 'rewe', status: 'BOOK', credit_debit_indicator: 'DBIT', transaction_amount: { currency: 'EUR', amount: '90.00' }, booking_date: '2026-08-02', remittance_information: ['REWE'] },
      { entry_reference: 'refund', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '50.00' }, booking_date: '2026-08-03', remittance_information: ['Refund'] },
    ] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore(reconciliationCalls)).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)
  assert.deepEqual(result.transactions.map((t) => t.amountCents).sort((a, b) => a - b), [-9000, 5000, 250_000].sort((a, b) => a - b))
  assert.equal(reconciliationCalls.length, 1)
  assert.equal(reconciliationCalls[0].transactionCount, 3)
  assert.equal(reconciliationCalls[0].uniqueTransactionCount, 3)
}))

// 12. GoCardless/PayPal behavior is unaffected -- neither provider's sync()
// path was touched by this fix (they have their own, already-correct sign
// handling: GoCardless's transactionAmount.amount already carries its own
// sign; PayPal's transaction_amount.value likewise). See
// enable-banking-auth-flow.test.js and providers-hardening.test.js for their
// own direct coverage; this is a targeted spot-check that GoCardless's
// distinct field names/signed-string convention are untouched.
test('12. GoCardless sign handling (already-signed transactionAmount.amount) is untouched by the Enable Banking sign fix', () => withRestoredFetch(async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/requisitions/req-1/')) return new Response(JSON.stringify({ status: 'ACTIVE', accounts: ['gc-acct-1'] }), { status: 200 })
    if (url.endsWith('/accounts/gc-acct-1/details/')) return new Response(JSON.stringify({ account: { name: 'Girokonto' } }), { status: 200 })
    if (url.endsWith('/accounts/gc-acct-1/balances/')) return new Response(JSON.stringify({ balances: [{ balanceAmount: { currency: 'EUR', amount: '100.00' } }] }), { status: 200 })
    if (url.includes('/accounts/gc-acct-1/transactions/')) return new Response(JSON.stringify({ transactions: { booked: [
      { transactionId: 'gc-dbit', transactionAmount: { currency: 'EUR', amount: '-10.00' }, bookingDate: '2026-08-01' },
    ], pending: [] } }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry({ GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key', ALLOW_JS_FINANCE_FALLBACK: 'true', NODE_ENV: 'test' }, fakeBankingCore()).get('gocardless')

  const result = await adapter.sync({ requisitionId: 'req-1', token: { access: 'tok', access_expires: Date.now() / 1000 + 3600 } })
  assert.equal(result.transactions[0].amountCents, -1000)
}))

// Exercises the committed Mock ASPSP EUR fixture (server/test/fixtures/
// enable-banking-mock-aspsp-eur-dataset.json) through the real sync()
// pipeline end to end, proving the fixture is actually correct against the
// fixes above -- not just documentation -- and giving the upcoming live
// Mock ASPSP sandbox pass a pre-verified expected-output baseline to
// compare real results against.
test('the committed Mock ASPSP EUR fixture produces exactly its own documented expected output through sync()', () => withRestoredFetch(async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/enable-banking-mock-aspsp-eur-dataset.json', import.meta.url), 'utf8'))
  const credential = { ...CREDENTIAL, accounts: [{ uid: fixture.account.uid, name: fixture.account.name, currency: fixture.account.currency, cashAccountType: fixture.account.cash_account_type }] }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    if (url.includes('/balances')) return new Response(JSON.stringify({ balances: [fixture.balance] }), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: fixture.transactions }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(credential)

  assert.equal(result.accounts[0].balanceCents, 695_950)
  assert.equal(result.transactions.length, fixture.transactions.length)
  for (const item of fixture.transactions) {
    const transaction = result.transactions.find((t) => t.externalId === `${fixture.account.uid}:${item.entry_reference}`)
    assert.ok(transaction, `expected a transaction for ${item.entry_reference}`)
    assert.equal(transaction.amountCents, fixture._expected_normalized_amountsCents[item.entry_reference])
    assert.equal(transaction.pending, fixture._expected_pending[item.entry_reference])
  }
}))

// Regression suite for the GET /sessions/{id}.accounts contract bug found
// during a live Mock ASPSP run (2026-08-25): that endpoint's `accounts`
// field is documented as an array of bare account-id STRINGS -- not
// AccountResource objects like POST /sessions returns -- so the previous
// code's `account.uid` was always undefined, producing requests like
// /accounts/undefined/balances and a real provider HTTP 422 on the very
// first sync after authorization.

test('A. the real documented GET-session shape (bare account-id strings) requests /accounts/acct-1/... and never /accounts/undefined/...', () => withRestoredFetch(async () => {
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({
      status: 'AUTHORIZED',
      accounts: ['acct-1'],
      accounts_data: [{ uid: 'acct-1', identification_hash: 'hash' }],
    }), { status: 200 })
    if (url.includes('/acct-1/balances')) return new Response(JSON.stringify(balancesResponse('10.00')), { status: 200 })
    if (url.includes('/acct-1/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(CREDENTIAL)

  assert.equal(result.accounts.length, 1)
  assert.equal(result.accounts[0].externalId, 'acct-1')
  assert.ok(requests.some((url) => url.includes('/accounts/acct-1/')), 'expected a request against the real account id')
  assert.ok(!requests.some((url) => url.includes('undefined')), `no request should ever target an undefined account id, got: ${JSON.stringify(requests)}`)
}))

test('B. multiple account IDs in the live session are all synced independently', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [
    { uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' },
    { uid: 'acct-2', name: 'Tagesgeld', currency: 'EUR', cashAccountType: 'SVGS' },
  ] }
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1', 'acct-2'] }), { status: 200 })
    if (url.includes('acct-1/balances')) return new Response(JSON.stringify(balancesResponse('10.00')), { status: 200 })
    if (url.includes('acct-2/balances')) return new Response(JSON.stringify(balancesResponse('20.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(credential)

  assert.deepEqual(result.accounts.map((a) => a.externalId).sort(), ['acct-1', 'acct-2'])
  assert.ok(!requests.some((url) => url.includes('undefined')))
}))

test('C. an account removed from the live session (still present in stored credential metadata) is no longer treated as active', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [
    { uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' },
    { uid: 'acct-removed', name: 'Closed account', currency: 'EUR', cashAccountType: 'CACC' },
  ] }
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    // The live session now only reports acct-1 -- acct-removed was closed
    // or its consent scope was narrowed at the bank.
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1'] }), { status: 200 })
    if (url.includes('acct-1/balances')) return new Response(JSON.stringify(balancesResponse('10.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(credential)

  assert.deepEqual(result.accounts.map((a) => a.externalId), ['acct-1'])
  assert.ok(!requests.some((url) => url.includes('acct-removed')), 'a removed account must never be fetched, not even once')
  assert.equal(result.credential.accounts.length, 1, 'the persisted credential must drop the removed account too, not just the transient sync result')
}))

// An explicit empty `accounts` array is real information (every account was
// removed/revoked at the bank) and must be honored, not papered over by
// falling back to stale stored accounts -- but the pre-existing
// zero-accounts health policy (assessBankConnectionHealth /
// completedHealth(), unrelated to and unweakened by this fix) then
// correctly fails the sync closed rather than silently reporting a
// successful empty result. Together these mean a fully-removed connection
// can never be silently misreported as either "still has its old accounts"
// or "successfully synced nothing."
test('an explicit empty accounts array from the live session never falls back to stale stored accounts (fails closed via the existing zero-accounts health policy instead)', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [{ uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' }] }
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(credential), /health policy/)
  assert.ok(!requests.some((url) => url.includes('acct-1')), 'the removed account must never be fetched, not even once')
}))

test('D. a new account id the session exposes (not in stored credential metadata) is safely retrieved via GET /accounts/{id}/details and normalized correctly', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [{ uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' }] }
  const requests = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1', 'acct-new'] }), { status: 200 })
    if (url.endsWith('/accounts/acct-new/details')) return new Response(JSON.stringify({ uid: 'acct-new', name: 'Newly Added', currency: 'EUR', cash_account_type: 'SVGS' }), { status: 200 })
    if (url.includes('acct-1/balances')) return new Response(JSON.stringify(balancesResponse('10.00')), { status: 200 })
    if (url.includes('acct-new/balances')) return new Response(JSON.stringify(balancesResponse('99.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(credential)

  assert.ok(requests.some((url) => url.endsWith('/accounts/acct-new/details')), 'must fetch real account details for a genuinely new account, never invent one')
  const newAccount = result.accounts.find((a) => a.externalId === 'acct-new')
  assert.ok(newAccount)
  assert.equal(newAccount.name, 'Newly Added')
  assert.equal(newAccount.balanceCents, 9900)
  assert.equal(result.credential.accounts.find((a) => a.uid === 'acct-new').cashAccountType, 'SVGS')
}))

test('a malformed GET /accounts/{id}/details response for a new account fails closed rather than inventing metadata', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [{ uid: 'acct-1', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' }] }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1', 'acct-new'] }), { status: 200 })
    // Malformed: uid in the details response doesn't match the requested account id.
    if (url.endsWith('/accounts/acct-new/details')) return new Response(JSON.stringify({ uid: 'someone-else', name: 'Wrong' }), { status: 200 })
    if (url.includes('acct-1/balances')) return new Response(JSON.stringify(balancesResponse('10.00')), { status: 200 })
    if (url.includes('/transactions')) return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(credential), /account details response is invalid/)
}))

test('E. a malformed account id from the live session fails the whole sync closed, never guessed or skipped silently', () => withRestoredFetch(async () => {
  const requests = []
  for (const malformed of [123, '', '   ', 'has a space', 'has/a/slash', null, { uid: 'nested-object' }, 'x'.repeat(129)]) {
    globalThis.fetch = async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: [malformed] }), { status: 200 })
      throw new Error(`Unexpected URL for malformed id ${JSON.stringify(malformed)}: ${url}`)
    }
    const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')
    await assert.rejects(adapter.sync(CREDENTIAL), /malformed account id/, `expected a fail-closed rejection for ${JSON.stringify(malformed)}`)
  }
  assert.ok(!requests.some((url) => url.includes('/balances') || url.includes('/transactions')), 'must never reach balances/transactions for a malformed account id')
}))

test('F. the first sync (no prior lastSyncedAt) requests transactions with strategy=longest', () => withRestoredFetch(async () => {
  const firstSyncCredential = { ...CREDENTIAL, lastSyncedAt: undefined }
  const transactionRequests = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1'] }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      transactionRequests.push({ strategy: url.searchParams.get('strategy'), dateFrom: url.searchParams.get('date_from'), dateTo: url.searchParams.get('date_to') })
      return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await adapter.sync(firstSyncCredential)

  assert.equal(transactionRequests.length, 1)
  assert.equal(transactionRequests[0].strategy, 'longest')
  assert.ok(transactionRequests[0].dateFrom, 'date_from is still sent as a lower-bound suggestion')
  assert.equal(transactionRequests[0].dateTo, null, 'date_to must be omitted in longest mode')
}))

test('G. a subsequent sync (lastSyncedAt present) uses the normal incremental date_from/date_to window, never strategy=longest', () => withRestoredFetch(async () => {
  const transactionRequests = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1'] }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      transactionRequests.push({ strategy: url.searchParams.get('strategy'), dateFrom: url.searchParams.get('date_from'), dateTo: url.searchParams.get('date_to') })
      return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  // CREDENTIAL already carries a lastSyncedAt (a routine, already-connected sync).
  await adapter.sync(CREDENTIAL)

  assert.equal(transactionRequests.length, 1)
  assert.equal(transactionRequests[0].strategy, null, 'must never send strategy=longest once a prior sync has succeeded')
  assert.ok(transactionRequests[0].dateFrom)
  assert.ok(transactionRequests[0].dateTo)
}))

test('H. continuation_key pagination keeps strategy and date parameters identical across every page, in first-sync (longest) mode', () => withRestoredFetch(async () => {
  const firstSyncCredential = { ...CREDENTIAL, lastSyncedAt: undefined }
  const transactionRequests = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/sessions/session-1') return new Response(JSON.stringify({ status: 'AUTHORIZED', accounts: ['acct-1'] }), { status: 200 })
    if (url.pathname.includes('/balances')) return new Response(JSON.stringify(balancesResponse('0.00')), { status: 200 })
    if (url.pathname.includes('/transactions')) {
      transactionRequests.push({ strategy: url.searchParams.get('strategy'), dateFrom: url.searchParams.get('date_from'), dateTo: url.searchParams.get('date_to'), continuationKey: url.searchParams.get('continuation_key') })
      if (!url.searchParams.get('continuation_key')) {
        return new Response(JSON.stringify({ transactions: [{ entry_reference: 'p1', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '1.00' }, booking_date: '2026-08-01', remittance_information: [] }], continuation_key: 'page-2' }), { status: 200 })
      }
      return new Response(JSON.stringify({ transactions: [{ entry_reference: 'p2', status: 'BOOK', credit_debit_indicator: 'CRDT', transaction_amount: { currency: 'EUR', amount: '2.00' }, booking_date: '2026-08-02', remittance_information: [] }] }), { status: 200 })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  const result = await adapter.sync(firstSyncCredential)

  assert.equal(transactionRequests.length, 2)
  assert.equal(transactionRequests[0].strategy, 'longest')
  assert.equal(transactionRequests[1].strategy, 'longest')
  assert.equal(transactionRequests[0].dateFrom, transactionRequests[1].dateFrom)
  assert.equal(transactionRequests[0].dateTo, null)
  assert.equal(transactionRequests[1].dateTo, null)
  assert.deepEqual(result.transactions.map((t) => t.externalId).sort(), ['acct-1:p1', 'acct-1:p2'])
}))

// Same fail-closed account-id validation applies even on the "session
// omitted accounts entirely, fall back to stored credential" path -- not
// just the path that reads live account ids from GET /sessions/{id}
// directly (review finding, 2026-08-25: the guarantee should hold
// end-to-end regardless of how a malformed uid could end up in
// credential.accounts, not only for data arriving through this one path).
test('a malformed stored account uid fails closed even on the "session omitted accounts" fallback path', () => withRestoredFetch(async () => {
  const credential = { ...CREDENTIAL, accounts: [{ uid: 'has a space', name: 'Girokonto', currency: 'EUR', cashAccountType: 'CACC' }] }
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/sessions/session-1')) return new Response(JSON.stringify({ status: 'AUTHORIZED' }), { status: 200 })
    throw new Error(`Unexpected URL: ${url}`)
  }
  const adapter = createOpenBankingProviderRegistry(eligibleEnv(), fakeBankingCore()).get('enablebanking')

  await assert.rejects(adapter.sync(credential), /malformed account id/)
}))
