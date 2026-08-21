import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8')

test('connector setup authenticates and authorizes before provider capability disclosure', () => {
  const startFunction = serverSource.slice(
    serverSource.indexOf('async function start(provider, request, response)'),
    serverSource.indexOf('async function buildSyncPayload'),
  )
  const authentication = startFunction.indexOf('const user = userId(request)')
  const providerLookup = startFunction.indexOf('const adapter = providerAdapter(provider)')
  const authorization = startFunction.indexOf('const description = authorizeProviderUser(adapter, user, env)')
  const availabilityCheck = startFunction.indexOf('if (!description.available)')
  assert.ok(authentication >= 0)
  assert.ok(authentication < providerLookup)
  assert.ok(providerLookup < authorization)
  assert.ok(authorization < availabilityCheck)
})

test('every stored owner-account connection is re-authorized before synchronization', () => {
  const syncFunction = serverSource.slice(
    serverSource.indexOf('async function buildSyncPayload(user)'),
    serverSource.indexOf('function syncIdempotencyKey'),
  )
  const authorization = syncFunction.indexOf('authorizeProviderUser(adapter, user, env)')
  const synchronization = syncFunction.indexOf('await adapter.sync(stored)')
  assert.ok(authorization >= 0)
  assert.ok(authorization < synchronization)
})

test('the provider callback route redirects every failure back into the app instead of returning raw JSON', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  // Provider lookup and state verification must be wrapped in a try/catch
  // that redirects (never throws out to the generic JSON error handler).
  const tryStart = callbackRoute.indexOf('try {')
  const providerLookup = callbackRoute.indexOf('providerAdapter(provider)')
  const stateVerify = callbackRoute.indexOf('verifyState(url.searchParams.get')
  const catchBlock = callbackRoute.indexOf('} catch {')
  assert.ok(tryStart >= 0 && tryStart < providerLookup && providerLookup < stateVerify && stateVerify < catchBlock)
  assert.match(callbackRoute.slice(catchBlock), /redirectWithError\(origin\)/, 'a state that fails to parse must redirect to the app origin, never to unverified input')

  const missingClaims = callbackRoute.indexOf('!state.consentId || !state.redirectUri')
  assert.ok(missingClaims > catchBlock)
  assert.match(callbackRoute.slice(missingClaims, missingClaims + 200), /redirectWithError\(origin\)/)

  const consumeCall = callbackRoute.indexOf('await store.consumePendingConnectionSetup(')
  const pendingFailure = callbackRoute.indexOf('if (!pending)')
  assert.ok(consumeCall > missingClaims && pendingFailure > consumeCall)
  // Once state HAS been cryptographically verified, its redirectUri is
  // trusted -- this and every failure branch after this point uses it.
  assert.match(callbackRoute.slice(pendingFailure, pendingFailure + 200), /redirectWithError\(state\.redirectUri\)/)
})

test('the provider callback route redirects instead of throwing raw JSON when consumePendingConnectionSetup itself fails (not just returns null)', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  // A DB error or a corrupted pending_payload throws out of
  // store.consumePendingConnectionSetup() itself, distinct from it resolving
  // null. That throw must still be caught and redirected -- state.redirectUri
  // is already verified by this point -- not left to propagate to the
  // top-level handler's raw-JSON error response.
  const consumeTry = callbackRoute.indexOf('try {\n        pending = await store.consumePendingConnectionSetup(')
  assert.ok(consumeTry >= 0, 'the consumePendingConnectionSetup call must be inside its own try block')
  const consumeCatch = callbackRoute.indexOf('} catch {', consumeTry)
  assert.ok(consumeCatch > consumeTry)
  assert.match(callbackRoute.slice(consumeCatch, consumeCatch + 200), /redirectWithError\(state\.redirectUri\)/)
})

test('the provider callback route runs completeCallback() only after the nonce has been consumed, and redirects on failure without exposing raw JSON', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  const pendingFailure = callbackRoute.indexOf('if (!pending)')
  const completeCallbackCall = callbackRoute.indexOf('providerAdapter(provider).completeCallback(')
  assert.ok(completeCallbackCall > pendingFailure, 'completeCallback() must only run after the pending setup has been consumed')
  assert.match(callbackRoute.slice(completeCallbackCall, completeCallbackCall + 200), /code: url\.searchParams\.get\('code'\), pending/)

  const completeCatch = callbackRoute.indexOf('} catch (error) {', completeCallbackCall)
  assert.ok(completeCatch > completeCallbackCall)
  const completeCatchBody = callbackRoute.slice(completeCatch, completeCatch + 800)
  // Distinguishes the provider denying authorization (an honest, distinct
  // error code) from every other completeCallback() failure (the generic
  // copy) -- but never reflects the raw provider/error text itself.
  assert.match(completeCatchBody, /error\?\.code === 'authorization_denied' \? 'access_denied' : 'invalid_state'/)
  assert.match(completeCatchBody, /redirectWithError\(state\.redirectUri,/)
})

test('the provider callback route never activates a connection until finalizeConnection succeeds, and redirects (not raw JSON) if it fails', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  const completeCallbackCall = callbackRoute.indexOf('providerAdapter(provider).completeCallback(')
  const finalizeCall = callbackRoute.indexOf('await store.finalizeConnection(')
  assert.ok(finalizeCall > completeCallbackCall, 'finalizeConnection must only run after completeCallback() has succeeded')
  const finalizeCatch = callbackRoute.indexOf('} catch {', finalizeCall)
  assert.ok(finalizeCatch > finalizeCall)
  assert.match(callbackRoute.slice(finalizeCatch, finalizeCatch + 800), /redirectWithError\(state\.redirectUri\)/)
  // The success redirect must come strictly after finalizeConnection, never before it.
  const successRedirect = callbackRoute.indexOf('const success = new URL(state.redirectUri)')
  assert.ok(successRedirect > finalizeCall)
})

test('the provider callback route never reflects a caller-controlled value into the failure redirect copy, for any error code', () => {
  const redirectWithError = serverSource.slice(
    serverSource.indexOf('const redirectWithError = (target, errorCode'),
    serverSource.indexOf('const redirectWithError = (target, errorCode') + 400,
  )
  // A fixed lookup table keyed by a fixed set of our own error codes, not a
  // passthrough of anything from the request -- CALLBACK_ERROR_COPY[errorCode]
  // only ever selects between our own pre-approved copy strings.
  assert.match(redirectWithError, /searchParams\.set\('error', errorCode\)/)
  assert.match(redirectWithError, /CALLBACK_ERROR_COPY\[errorCode\] \|\| CALLBACK_ERROR_COPY\.invalid_state/)
  assert.doesNotMatch(redirectWithError, /url\.searchParams\.get/, 'the failure redirect must never read attacker-influenced query params into its own copy')

  // CALLBACK_ERROR_COPY itself must be a frozen, fixed set of our own strings.
  const errorCopy = serverSource.slice(serverSource.indexOf('const CALLBACK_ERROR_COPY = Object.freeze({'), serverSource.indexOf('const CALLBACK_ERROR_COPY = Object.freeze({') + 300)
  assert.match(errorCopy, /invalid_state:/)
  assert.match(errorCopy, /access_denied:/)
})

test('the provider callback route appends ?provider= to the success redirect so the frontend return-detector actually fires', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  const finalizeCall = callbackRoute.indexOf('await store.finalizeConnection(')
  const successBlock = callbackRoute.slice(finalizeCall)
  assert.match(successBlock, /const success = new URL\(state\.redirectUri\)/)
  assert.match(successBlock, /success\.searchParams\.set\('provider', provider\)/)
  assert.match(successBlock, /Location: success\.toString\(\)/)
})

test('connector deletion authenticates before validating a provider identifier', () => {
  const disconnectRoute = serverSource.slice(
    serverSource.indexOf("if (request.method === 'DELETE' && disconnect)"),
    serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')"),
  )
  assert.ok(disconnectRoute.indexOf('const user = userId(request)') < disconnectRoute.indexOf('providerAdapter(disconnect[1])'))
})

test('connector deletion attempts provider-side revocation but never claims it succeeded without the adapter confirming, and always removes the local record', () => {
  const disconnectRoute = serverSource.slice(
    serverSource.indexOf("if (request.method === 'DELETE' && disconnect)"),
    serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')"),
  )
  const storedLookup = disconnectRoute.indexOf('const stored = await store.get(user, disconnect[1])')
  const revokeAttempt = disconnectRoute.indexOf('await adapter.disconnect(stored)')
  const localRemoval = disconnectRoute.indexOf('await store.remove(user, disconnect[1])')
  assert.ok(storedLookup >= 0 && revokeAttempt >= 0 && localRemoval >= 0)
  assert.ok(storedLookup < revokeAttempt, 'must look up the stored credential before attempting revocation')
  assert.ok(revokeAttempt < localRemoval, 'local removal must happen after the revocation attempt is resolved (not raced with it)')
  // Local removal must not live inside the revoke try{} block -- a provider
  // failure/exception must never prevent the user's own disconnect from
  // completing.
  const tryBlock = disconnectRoute.slice(disconnectRoute.lastIndexOf('try {', revokeAttempt), disconnectRoute.indexOf('}', revokeAttempt))
  assert.ok(!tryBlock.includes('store.remove'), 'local removal must not be inside the provider-revoke try block')
  assert.match(disconnectRoute, /providerRevoked = Boolean\(outcome\?\.revoked\)/, 'must derive providerRevoked from the adapter outcome, never hardcode it')
  assert.match(disconnectRoute, /disconnected: true, providerRevoked, providerRevokeReason/)
})

test('connector start forwards the client-selected institutionId to the provider adapter for server-side validation', () => {
  const startFunction = serverSource.slice(
    serverSource.indexOf('async function start(provider, request, response)'),
    serverSource.indexOf('async function buildSyncPayload'),
  )
  assert.match(startFunction, /const institutionId = /)
  assert.match(startFunction, /adapter\.start\(\{[^}]*institutionId[^}]*\}\)/s)
})

test('the provider listing and institution directory endpoints authenticate before returning provider data', () => {
  const providersRoute = serverSource.slice(
    serverSource.indexOf("url.pathname === '/api/connectors') {"),
    serverSource.indexOf("const match = url.pathname.match(/^\\/api\\/connectors\\/([a-z0-9][a-z0-9-]{1,39})\\/start$/)"),
  )
  assert.ok(providersRoute.length > 0, 'provider listing/institutions route block was not found')
  const providersHandler = providersRoute.slice(0, providersRoute.indexOf('institutionsMatch'))
  assert.match(providersHandler, /userId\(request\)/)
  const institutionsHandler = providersRoute.slice(providersRoute.indexOf('institutionsMatch'))
  const authentication = institutionsHandler.indexOf('userId(request)')
  const directoryCall = institutionsHandler.indexOf('adapter.institutionDirectory(')
  assert.ok(authentication >= 0 && directoryCall >= 0)
  assert.ok(authentication < directoryCall, 'institution directory must authenticate before disclosing institutions')
})

test('the institution directory endpoint applies the same owner-mode authorization gate as /start, not just authentication', () => {
  const institutionsHandler = serverSource.slice(
    serverSource.indexOf('institutionsMatch'),
    serverSource.indexOf("const match = url.pathname.match(/^\\/api\\/connectors\\/([a-z0-9][a-z0-9-]{1,39})\\/start$/)"),
  )
  const authentication = institutionsHandler.indexOf('const user = userId(request)')
  const authorization = institutionsHandler.indexOf('authorizeProviderUser(adapter, user, env)')
  const directoryCall = institutionsHandler.indexOf('adapter.institutionDirectory(')
  assert.ok(authentication >= 0 && authorization >= 0 && directoryCall >= 0)
  assert.ok(authentication < authorization && authorization < directoryCall, 'must authenticate, then authorize (owner-mode gate), then disclose institutions -- in that order')
})

test('the institution logo endpoint authenticates and authorizes before ever resolving/fetching a logo', () => {
  const logoHandler = serverSource.slice(
    serverSource.indexOf("const logoMatch = url.pathname.match(/^\\/api\\/connectors\\/([a-z0-9][a-z0-9-]{1,39})\\/logo$/)"),
    serverSource.indexOf("const match = url.pathname.match(/^\\/api\\/connectors\\/([a-z0-9][a-z0-9-]{1,39})\\/start$/)"),
  )
  const authentication = logoHandler.indexOf('const user = userId(request)')
  const authorization = logoHandler.indexOf('authorizeProviderUser(adapter, user, env)')
  const logoCall = logoHandler.indexOf('adapter.fetchInstitutionLogo(')
  assert.ok(authentication >= 0 && authorization >= 0 && logoCall >= 0)
  assert.ok(authentication < authorization && authorization < logoCall, 'must authenticate, then authorize (owner-mode gate), then resolve/fetch a logo -- in that order, same as the institution directory endpoint')
  // The client only ever supplies an institutionId (bounded, trimmed) --
  // never a URL. There is no code path here that could take an
  // arbitrary/attacker-supplied URL as input.
  assert.match(logoHandler, /searchParams\.get\('institutionId'\)\.trim\(\)\.slice\(0, 128\)/)
  assert.doesNotMatch(logoHandler, /searchParams\.get\('url'\)|searchParams\.get\('logo'\)/)
})

test('connector start validates the country code the same way the institution directory endpoint already does', () => {
  const startFunction = serverSource.slice(
    serverSource.indexOf('async function start(provider, request, response)'),
    serverSource.indexOf('async function buildSyncPayload'),
  )
  assert.match(startFunction, /const country = String\(input\.country \|\| 'DE'\)\.toUpperCase\(\)/)
  assert.match(startFunction, /if \(!\/\^\[A-Z\]\{2\}\$\/\.test\(country\)\) throw new HttpError\(400, 'invalid_country'/)
  const validation = startFunction.indexOf("throw new HttpError(400, 'invalid_country'")
  const adapterCall = startFunction.indexOf('await adapter.start(')
  assert.ok(validation >= 0 && validation < adapterCall, 'country must be validated before it ever reaches the adapter (and its unbounded institutionsCache)')
  assert.doesNotMatch(startFunction, /country: input\.country \|\| 'DE'/, 'must not pass the raw unvalidated client value to the adapter')
})

test('the provider listing endpoint returns per-user descriptors, not the raw registry list', () => {
  const providersHandler = serverSource.slice(
    serverSource.indexOf("url.pathname === '/api/connectors') {"),
    serverSource.indexOf('institutionsMatch'),
  )
  assert.match(providersHandler, /const user = userId\(request\)/)
  assert.match(providersHandler, /describeProviderForUser\(adapter, user, env\)/)
  assert.doesNotMatch(providersHandler, /providerRegistry\.list\(\)/, 'must not expose the same descriptor to every user regardless of owner-mode authorization')
})

test('core readiness is independent from optional bank capability readiness', () => {
  const readinessRoute = serverSource.slice(
    serverSource.indexOf("if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/ready'))"),
    serverSource.indexOf('const webhook = url.pathname.match'),
  )
  assert.match(readinessRoute, /const serviceReady = ready/)
  assert.doesNotMatch(readinessRoute, /capabilities\.ready/)
  assert.doesNotMatch(readinessRoute, /capabilities\.production/)
  assert.match(serverSource, /capabilities\.ready \? 200 : 503/)
})
