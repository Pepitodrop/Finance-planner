import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8')
const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
const callbackRoute = serverSource.slice(
  callbackStart,
  serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
)

test('auxiliary callback navigation exits before nonce consumption', () => {
  const completionCheck = callbackRoute.indexOf('if (!hasCompletionSignal)')
  const consume = callbackRoute.indexOf('await store.consumePendingConnectionSetup(')
  assert.ok(completionCheck >= 0, 'completion-signal guard must exist')
  assert.ok(consume > completionCheck, 'nonce consumption must occur only after the auxiliary-callback guard')
  assert.match(callbackRoute.slice(completionCheck, consume), /redirectWithoutError\(state\.redirectUri\)/)
})

test('a consumed nonce is replay-idempotent only after exact finalized-attempt matching', () => {
  const pendingMiss = callbackRoute.indexOf('if (!pending)')
  const storedLookup = callbackRoute.indexOf('await store.get(state.sub, provider)', pendingMiss)
  const match = callbackRoute.indexOf('completedConnectionMatchesState(stored, state, provider)', storedLookup)
  const replaySuccess = callbackRoute.indexOf("success.searchParams.set('provider', provider)", match)
  const completeCallback = callbackRoute.indexOf('providerAdapter(provider).completeCallback(', pendingMiss)
  assert.ok(pendingMiss >= 0)
  assert.ok(storedLookup > pendingMiss)
  assert.ok(match > storedLookup)
  assert.ok(replaySuccess > match)
  assert.ok(completeCallback > replaySuccess, 'an already-finalized replay must return before attempting a second code exchange')
})

test('callbacks carrying code/error still require signed state', () => {
  const stateVerify = callbackRoute.indexOf("verifyState(url.searchParams.get('state'), sessionSecret)")
  const invalidStateError = callbackRoute.indexOf('redirectWithError(origin)', stateVerify)
  const consume = callbackRoute.indexOf('await store.consumePendingConnectionSetup(')
  assert.ok(stateVerify >= 0)
  assert.ok(invalidStateError > stateVerify)
  assert.ok(consume > invalidStateError)
})
