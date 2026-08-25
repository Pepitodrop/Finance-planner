import assert from 'node:assert/strict'
import test from 'node:test'
import { completeConnectorCallback, completedConnectionMatchesState, waitForPendingConnectionCompletion } from '../src/provider-callback.js'

// A minimal, hand-rolled "alternate connector-store implementation" of the
// claimPendingConnectionSetup()/pendingConnectionSetupExists()/
// releasePendingConnectionSetup()/finalizeConnection()/get() contract --
// deliberately NOT PostgresStore or EncryptedStore, so these tests prove
// completeConnectorCallback()'s own orchestration logic is correct against
// the *contract*, independent of which real store backs it (both of which
// have their own dedicated tests proving they satisfy this same contract:
// server/test/postgres-store.test.js includes a real-concurrent-Postgres-
// clients version of the centerpiece race below; server/test/
// crypto-store.test.js covers the in-memory store's claim/release
// lifecycle).
function fakeStore() {
  const nonces = new Map()
  const connections = new Map()
  let claimTokenCounter = 0

  function matches(entry, input) {
    return Boolean(
      entry &&
      entry.consentId === input.consentId &&
      entry.userId === input.userId &&
      entry.provider === input.provider &&
      entry.redirectUri === input.redirectUri &&
      entry.expiresAt > input.now &&
      // Mirrors the real stores: the pending payload itself also carries
      // consentId/redirectUri, cross-checked against the nonce row's own
      // metadata (see PostgresStore.claimPendingConnectionSetup()).
      entry.connection?.consentId === input.consentId &&
      entry.connection?.redirectUri === input.redirectUri,
    )
  }

  return {
    registerNonce(nonce, entry) { nonces.set(nonce, { claimToken: null, expiresAt: Date.now() + 600_000, ...entry }) },
    connectionFor(userId, provider) { return connections.get(`${userId}:${provider}`) || null },

    async claimPendingConnectionSetup(input) {
      const entry = nonces.get(input.nonce)
      if (!matches(entry, input)) return { status: 'not_found' }
      if (entry.claimToken) return { status: 'in_progress' }
      claimTokenCounter += 1
      entry.claimToken = `claim-${claimTokenCounter}`
      return { status: 'claimed', claimToken: entry.claimToken, connection: entry.connection }
    },
    async pendingConnectionSetupExists(input) {
      const entry = nonces.get(input.nonce)
      return matches(entry, input)
    },
    async releasePendingConnectionSetup(input) {
      const entry = nonces.get(input.nonce)
      if (!entry || entry.claimToken !== input.claimToken) return false
      nonces.delete(input.nonce)
      return true
    },
    async finalizeConnection(input) {
      connections.set(`${input.userId}:${input.provider}`, { ...input.connection, connectedAt: input.connectedAt })
    },
    async get(userId, provider) {
      return connections.get(`${userId}:${provider}`) || null
    },
  }
}

function fakeState(overrides = {}) {
  return {
    nonce: 'nonce-1', consentId: 'consent-1', sub: 'user-1', provider: 'enablebanking', redirectUri: 'https://app.test/callback',
    ...overrides,
  }
}

// The pending payload itself carries consentId/redirectUri (cross-checked
// against the nonce row's own metadata by the real stores -- see
// PostgresStore.claimPendingConnectionSetup()), so any test that registers
// a nonce for a given state must build the connection payload from it,
// exactly like the real /start flow does.
function fakePendingConnection(state, extra = {}) {
  return { consentId: state.consentId, redirectUri: state.redirectUri, ...extra }
}

function countingProvider(overrides = {}) {
  const calls = { completeCallback: 0, disconnect: 0 }
  return {
    calls,
    // Default mirrors a real adapter's completeCallback() contract: the
    // resolved connection preserves whatever consentId/redirectUri the
    // pending credential carried (a bare pass-through for GoCardless/
    // PayPal, a merge for Enable Banking -- see providers.js), which is
    // exactly what completedConnectionMatchesState() checks against on a
    // later replay. A test override that discards these would silently
    // break replay-matching in a way the real adapters never do.
    completeCallback: async (args) => { calls.completeCallback += 1; return overrides.completeCallback ? overrides.completeCallback(args) : { ...args.pending, sessionId: 'session-1' } },
    disconnect: async (...args) => { calls.disconnect += 1; return overrides.disconnect ? overrides.disconnect(...args) : undefined },
  }
}

test('a normal, uncontested callback claims, exchanges, finalizes, and releases exactly once', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state, { aspspName: 'ING-DiBa' }) })
  const provider = countingProvider()

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'success' })
  assert.equal(provider.calls.completeCallback, 1)
  assert.equal(store.connectionFor(state.sub, state.provider)?.sessionId, 'session-1')
  // Released after success -- a later claim attempt sees the nonce as gone.
  assert.equal((await store.claimPendingConnectionSetup({ nonce: state.nonce, consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, now: Date.now() })).status, 'not_found')
})

test('an unrelated nonce fails closed as invalid_state, never guessed or half-trusted', async () => {
  const store = fakeStore()
  const state = fakeState({ nonce: 'nonce-that-was-never-registered' })
  const provider = countingProvider()

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.completeCallback, 0)
})

test('same user/provider but a different consentId than what was registered fails closed', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: 'a-different-consent-id', userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: {} })
  const provider = countingProvider()

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.completeCallback, 0)
})

test('same consentId but a different redirectUri than what was registered fails closed', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: 'https://app.test/a-different-callback', connection: {} })
  const provider = countingProvider()

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.completeCallback, 0)
})

test('an expired claim fails closed the same way an unrelated nonce does', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state), expiresAt: Date.now() - 1000 })
  const provider = countingProvider()

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.completeCallback, 0)
})

test('completeCallback() failure releases the claim and fails closed without ever calling finalizeConnection', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })
  const provider = countingProvider({ completeCallback: async () => { throw new Error('provider rejected the code') } })

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(store.connectionFor(state.sub, state.provider), null)
  assert.equal((await store.pendingConnectionSetupExists({ nonce: state.nonce, consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, now: Date.now() })), false, 'the claim must be released, not left dangling, after a failure')
})

test('the provider denying authorization is distinguished as access_denied, never the generic invalid_state copy', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })
  const provider = countingProvider({ completeCallback: async () => { const error = new Error('denied'); error.code = 'authorization_denied'; throw error } })

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'access_denied' })
})

test('finalizeConnection() failure best-effort disconnects the just-created provider session, releases the claim, and fails closed', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })
  store.finalizeConnection = async () => { throw new Error('disk unavailable') }
  const provider = countingProvider()

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.disconnect, 1, 'a provider-side session that was just created must be best-effort revoked when local finalization fails')
})

test('a disconnect() failure during finalize-error cleanup never changes the error the caller sees', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })
  store.finalizeConnection = async () => { throw new Error('disk unavailable') }
  const provider = countingProvider({ disconnect: async () => { throw new Error('provider unreachable') } })

  const result = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
})

test('a genuine replay after successful finalization (the claim already released) is treated as idempotent success, without re-running completeCallback()', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state, { aspspName: 'ING-DiBa' }) })
  const provider = countingProvider()
  const first = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })
  assert.deepEqual(first, { outcome: 'success' })

  const replay = await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  assert.deepEqual(replay, { outcome: 'success' })
  assert.equal(provider.calls.completeCallback, 1, 'a replay after finalization must never re-exchange the provider code')
})

test('a replay for a DIFFERENT consentId than the one that actually finalized is not treated as a match, even for the same user/provider', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })
  const provider = countingProvider()
  await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code' })

  const differentAttempt = fakeState({ nonce: 'nonce-2', consentId: 'a-different-consent-id' })
  const result = await completeConnectorCallback({ store, providerAdapter: provider, state: differentAttempt, code: 'auth-code-2' })

  assert.deepEqual(result, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.completeCallback, 1, 'merely sharing a user/provider with an already-finalized connection must never be accepted as proof of a matching attempt')
})

// This is the centerpiece regression for the live concurrent-duplicate-
// callback race (2026-08-25, Mock ASPSP run against PR #154): a real
// production run logged two GET /api/connectors/callback deliveries for one
// authorization (~5ms and ~343ms), and the first (faster) one to resolve
// returned invalid_state even though the slower one went on to finalize the
// connection successfully moments later. This reproduces that exact
// shape -- two concurrent completeConnectorCallback() calls for the exact
// same signed state, the first deliberately paused inside
// providerAdapter.completeCallback() until released -- and proves the fix:
// exactly one provider code exchange, exactly one finalizeConnection() call,
// one live connector connection, and BOTH callbacks resolving to the same
// success outcome with no transient invalid_state anywhere.
test('two concurrent callbacks for the exact same verified attempt: the provider code is exchanged exactly once, and both callbacks resolve to the same success', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state, { aspspName: 'ING-DiBa' }) })

  let releaseExchange
  let startedResolve
  const startedPromise = new Promise((resolve) => { startedResolve = resolve })
  const finishPromise = new Promise((resolve) => { releaseExchange = resolve })
  const provider = countingProvider({
    // Merges args.pending same as the default (see countingProvider's own
    // comment) -- a real adapter never drops consentId/redirectUri either.
    completeCallback: async (args) => {
      startedResolve()
      const result = await finishPromise
      return { ...args.pending, ...result }
    },
  })

  // Fast wait polling so the test resolves quickly once B is released to
  // observe A's outcome -- the real 150ms/20s defaults are for production,
  // not for keeping a unit test snappy.
  const wait = (args) => waitForPendingConnectionCompletion({ ...args, pollIntervalMs: 5, maxWaitMs: 5000 })

  const promiseA = completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code', wait })
  await startedPromise // A has claimed and is now genuinely blocked inside completeCallback()

  const promiseB = completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code', wait })
  // Give B a moment to actually reach and observe the in_progress claim
  // before A is released, so this genuinely exercises the wait path rather
  // than accidentally racing ahead of it.
  await new Promise((resolve) => setTimeout(resolve, 20))

  releaseExchange({ sessionId: 'session-1' })
  const [resultA, resultB] = await Promise.all([promiseA, promiseB])

  assert.deepEqual(resultA, { outcome: 'success' })
  assert.deepEqual(resultB, { outcome: 'success' })
  assert.equal(provider.calls.completeCallback, 1, 'the provider authorization code must be exchanged at most once, even with two concurrent deliveries')
  assert.equal(store.connectionFor(state.sub, state.provider)?.sessionId, 'session-1')
})

test('two concurrent callbacks for the exact same attempt, where the claimer ultimately fails: the duplicate does not fabricate success', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })

  let startedResolve
  const startedPromise = new Promise((resolve) => { startedResolve = resolve })
  let releaseExchange
  const finishPromise = new Promise((resolve, reject) => { releaseExchange = reject })
  const provider = countingProvider({ completeCallback: async () => { startedResolve(); return finishPromise } })
  const wait = (args) => waitForPendingConnectionCompletion({ ...args, pollIntervalMs: 5, maxWaitMs: 5000 })

  const promiseA = completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code', wait })
  await startedPromise

  const promiseB = completeConnectorCallback({ store, providerAdapter: provider, state, code: 'auth-code', wait })
  await new Promise((resolve) => setTimeout(resolve, 20))

  releaseExchange(new Error('provider rejected the code'))
  const [resultA, resultB] = await Promise.all([promiseA, promiseB])

  assert.deepEqual(resultA, { outcome: 'error', errorCode: 'invalid_state' })
  assert.deepEqual(resultB, { outcome: 'error', errorCode: 'invalid_state' })
  assert.equal(provider.calls.completeCallback, 1, 'a failed exchange must still never be retried by the duplicate')
  assert.equal(store.connectionFor(state.sub, state.provider), null)
})

test('waitForPendingConnectionCompletion gives up after its bounded timeout if the claim never resolves, rather than waiting forever', async () => {
  const store = fakeStore()
  const state = fakeState()
  // Registered but never claimed nor released -- pendingConnectionSetupExists() will report true forever.
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state) })

  const startedAt = Date.now()
  const result = await waitForPendingConnectionCompletion({ store, state, maxWaitMs: 60, pollIntervalMs: 10 })
  const elapsedMs = Date.now() - startedAt

  assert.deepEqual(result, { status: 'not_found' })
  assert.ok(elapsedMs < 1000, `expected a bounded wait, took ${elapsedMs}ms`)
})

test('completedConnectionMatchesState requires connectedAt, matching consentId/redirectUri, and matching provider -- never just "same user"', () => {
  const state = fakeState()
  assert.equal(completedConnectionMatchesState(null, state, state.provider), false)
  assert.equal(completedConnectionMatchesState({ consentId: state.consentId, redirectUri: state.redirectUri }, state, state.provider), false, 'no connectedAt means never finalized')
  assert.equal(completedConnectionMatchesState({ connectedAt: '2026-08-25T00:00:00Z', consentId: 'other', redirectUri: state.redirectUri }, state, state.provider), false)
  assert.equal(completedConnectionMatchesState({ connectedAt: '2026-08-25T00:00:00Z', consentId: state.consentId, redirectUri: 'https://app.test/other' }, state, state.provider), false)
  assert.equal(completedConnectionMatchesState({ connectedAt: '2026-08-25T00:00:00Z', consentId: state.consentId, redirectUri: state.redirectUri }, state, 'a-different-provider'), false)
  assert.equal(completedConnectionMatchesState({ connectedAt: '2026-08-25T00:00:00Z', consentId: state.consentId, redirectUri: state.redirectUri }, state, state.provider), true)
})

test('observability: log() receives fixed event names, provider, and timing only -- never the code, nonce, consentId, or decoded payload', async () => {
  const store = fakeStore()
  const state = fakeState()
  store.registerNonce(state.nonce, { consentId: state.consentId, userId: state.sub, provider: state.provider, redirectUri: state.redirectUri, connection: fakePendingConnection(state, { aspspName: 'ING-DiBa' }) })
  const provider = countingProvider()
  const events = []

  await completeConnectorCallback({ store, providerAdapter: provider, state, code: 'super-secret-auth-code', log: (fields) => events.push(fields) })

  assert.ok(events.length > 0)
  const serialized = JSON.stringify(events)
  assert.doesNotMatch(serialized, /super-secret-auth-code/)
  assert.doesNotMatch(serialized, /nonce-1|consent-1/)
  assert.doesNotMatch(serialized, /aspspName|ING-DiBa/)
  for (const event of events) {
    assert.equal(typeof event.event, 'string')
    assert.equal(event.provider, state.provider)
  }
  assert.ok(events.some((event) => event.event === 'connector_callback_claim'))
  assert.ok(events.some((event) => event.event === 'connector_callback_completed'))
})
