import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8')
const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
const callbackRoute = serverSource.slice(
  callbackStart,
  serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
)

test('auxiliary callback navigation exits before the callback-completion algorithm ever runs', () => {
  const completionCheck = callbackRoute.indexOf('if (!hasCompletionSignal)')
  const complete = callbackRoute.indexOf('await completeConnectorCallback(')
  assert.ok(completionCheck >= 0, 'completion-signal guard must exist')
  assert.ok(complete > completionCheck, 'the callback-completion algorithm must run only after the auxiliary-callback guard')
  assert.match(callbackRoute.slice(completionCheck, complete), /redirectWithoutError\(state\.redirectUri\)/)
})

// The actual replay-idempotency/exactly-once-completeCallback logic this
// test used to assert via source-text position now lives in
// provider-callback.js's completeConnectorCallback() (extracted 2026-08-25
// while fixing a live concurrent-duplicate-callback race -- see
// server/test/provider-callback.test.js for the real behavioral coverage,
// including the exact race this replaced: two concurrent deliveries of the
// same verified attempt, one paused mid-completeCallback(), must resolve to
// a single provider code exchange and a single finalized connection, with
// both callbacks receiving the same success outcome). What remains testable
// here, at the server.js boundary, is only that the whole algorithm's
// outcome is translated into a redirect, never raw JSON -- covered below and
// in open-banking-server-boundary.test.js.
test('the callback-completion algorithm result is always translated into a redirect, success or error, never left to throw raw JSON', () => {
  const complete = callbackRoute.indexOf('completed = await completeConnectorCallback(')
  const completeTry = callbackRoute.lastIndexOf('try {', complete)
  const completeCatch = callbackRoute.indexOf('} catch {', complete)
  assert.ok(complete >= 0 && completeTry >= 0 && completeTry < complete && completeCatch > complete, 'completeConnectorCallback() must be called inside a try/catch')
  assert.match(callbackRoute.slice(completeCatch, completeCatch + 200), /redirectWithError\(state\.redirectUri\)/, 'a thrown completion must still redirect with state.redirectUri, never propagate to the raw-JSON error handler')

  const outcomeCheck = callbackRoute.indexOf("completed.outcome === 'error'", completeCatch)
  assert.ok(outcomeCheck > completeCatch)
  assert.match(callbackRoute.slice(outcomeCheck, outcomeCheck + 200), /redirectWithError\(state\.redirectUri, completed\.errorCode\)/)

  const successBlock = callbackRoute.slice(outcomeCheck)
  assert.match(successBlock, /const success = new URL\(state\.redirectUri\)/)
  assert.match(successBlock, /success\.searchParams\.set\('provider', provider\)/)
})

test('callbacks carrying code/error still require signed state', () => {
  const stateVerify = callbackRoute.indexOf("verifyState(url.searchParams.get('state'), sessionSecret)")
  const invalidStateError = callbackRoute.indexOf('redirectWithError(origin)', stateVerify)
  const complete = callbackRoute.indexOf('await completeConnectorCallback(')
  assert.ok(stateVerify >= 0)
  assert.ok(invalidStateError > stateVerify)
  assert.ok(complete > invalidStateError)
})

test('the callback route never logs the authorization code, signed state, or any provider payload -- only fixed event names, provider id, and timing', () => {
  const logCall = callbackRoute.indexOf('log: (fields) =>')
  assert.ok(logCall >= 0, 'a diagnostics log callback must be wired into completeConnectorCallback()')
  const logLine = callbackRoute.slice(logCall, callbackRoute.indexOf('\n', logCall) + 1)
  assert.doesNotMatch(logLine, /searchParams\.get\('code'\)|state\.nonce|state\.consentId|pending|completed\b/i, 'the log wiring itself must never reference the code, nonce, consentId, or decoded payload -- only whatever fixed, non-sensitive fields completeConnectorCallback() itself chooses to pass to it')
})
