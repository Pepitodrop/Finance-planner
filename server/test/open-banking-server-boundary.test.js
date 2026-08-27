import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8')

test('rate limiting dispatches through the shared rateLimitTier() classifier, not a locally re-implemented pattern', () => {
  // Regression guard for the live production defect (2026-08-21): a
  // second, drifted copy of the sensitive-route regex living directly in
  // server.js (rather than importing the single classifier from
  // runtime-security.js, which server/src/runtime-security.test.js unit
  // tests directly) is exactly how the logo-vs-sensitive bug could
  // silently reappear.
  assert.match(serverSource, /import \{[^}]*rateLimitTier[^}]*\} from '\.\/runtime-security\.js'/)
  const rateLimitFunction = serverSource.slice(
    serverSource.indexOf('async function rateLimit(request, response, pathname)'),
    serverSource.indexOf('function providerAdapter'),
  )
  assert.ok(rateLimitFunction.length > 0, 'rateLimit() was not found')
  assert.match(rateLimitFunction, /const tier = rateLimitTier\(pathname\)/)
  assert.doesNotMatch(rateLimitFunction, /\/\^\\\/api\\\/\(auth\|session\|connectors/, 'must not re-implement the sensitive-route pattern locally')
})

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

// Regression guard for the Enable Banking Auth Flow widget descriptor
// (2026-08-22): the /start response must explicitly whitelist exactly
// {provider, authorizationId, origin, sandbox} from result.authFlow, never
// spread it (or the whole `result` object, which also carries `credential`
// -- signed state, institutionId, aspspName/country, accessValidUntil --
// destined only for server-side pending-setup storage, never the browser).
test('the /start response whitelists exactly four authFlow fields and never spreads the raw provider result', () => {
  const startFunction = serverSource.slice(
    serverSource.indexOf('async function start(provider, request, response)'),
    serverSource.indexOf('async function buildSyncPayload'),
  )
  assert.match(startFunction, /result\.authFlow\.provider/)
  assert.match(startFunction, /result\.authFlow\.authorizationId/)
  assert.match(startFunction, /result\.authFlow\.origin/)
  assert.match(startFunction, /result\.authFlow\.sandbox/)
  assert.doesNotMatch(startFunction, /\.\.\.result(?!\.)/, 'must never spread the whole provider result object itself (as opposed to its nested .credential, used only for server-side pending-setup storage) into the client response')
  assert.doesNotMatch(startFunction, /\.\.\.result\.authFlow\b/, 'must whitelist authFlow fields explicitly, never forward the object verbatim')
  const sendCall = startFunction.slice(startFunction.indexOf('send(response, 200'))
  assert.doesNotMatch(sendCall, /credential/i, 'the client-facing /start response must never mention credential (signed state, institutionId, aspspName/country, accessValidUntil live server-side only)')
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
  // State verification and provider lookup must be wrapped in a try/catch
  // that redirects (never throws out to the generic JSON error handler).
  // State is verified FIRST (2026-08-21 redirect_uri architecture fix) --
  // the provider identity is derived FROM the verified state's own payload,
  // never from an external, unauthenticated query parameter, so there is
  // nothing to look up until the state itself is known to be genuine.
  const tryStart = callbackRoute.indexOf('try {')
  const stateVerify = callbackRoute.indexOf('verifyState(url.searchParams.get')
  const providerLookup = callbackRoute.indexOf('providerAdapter(provider)')
  const catchBlock = callbackRoute.indexOf('} catch {')
  assert.ok(tryStart >= 0 && tryStart < stateVerify && stateVerify < providerLookup && providerLookup < catchBlock)
  assert.match(callbackRoute.slice(tryStart, catchBlock), /provider = state\.provider/, 'provider must be derived from the verified state, not a query parameter')
  assert.match(callbackRoute.slice(catchBlock), /redirectWithError\(origin\)/, 'a state that fails to parse must redirect to the app origin, never to unverified input')

  const missingClaims = callbackRoute.indexOf('!state.consentId || !state.redirectUri')
  assert.ok(missingClaims > catchBlock)
  assert.match(callbackRoute.slice(missingClaims, missingClaims + 200), /redirectWithError\(origin\)/)

  const completeCall = callbackRoute.indexOf('await completeConnectorCallback(')
  const completeCatch = callbackRoute.indexOf('} catch {', completeCall)
  assert.ok(completeCall > missingClaims && completeCatch > completeCall)
  // Once state HAS been cryptographically verified, its redirectUri is
  // trusted -- a thrown completion (a DB error, a corrupted pending_payload,
  // anything completeConnectorCallback() itself doesn't catch) redirects
  // with it rather than propagating to the raw-JSON error handler. The
  // exactly-once-claim / concurrent-duplicate-safe logic that used to be
  // inline here (nonce consumption, replay detection) now lives entirely
  // inside completeConnectorCallback() -- see provider-callback.test.js for
  // its own direct behavioral coverage of that algorithm, including the
  // concurrent-duplicate race this whole extraction exists to fix.
  assert.match(callbackRoute.slice(completeCatch, completeCatch + 200), /redirectWithError\(state\.redirectUri\)/)
})

test('the provider callback route never reads a client-supplied ?provider= query parameter -- the source no longer contains that pattern at all', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  assert.doesNotMatch(callbackRoute, /searchParams\.get\('provider'\)/, 'provider must be derived from the verified state, never trusted from an unauthenticated query parameter (fixed 2026-08-21 after a live REDIRECT_URI_NOT_ALLOWED rejection)')
})

// Fixed 2026-08-25 (live concurrent-duplicate-callback race, Mock ASPSP run
// against PR #154): the nonce-claim / completeCallback() / finalizeConnection
// sequencing this pair of tests used to check via source-text position now
// lives entirely inside provider-callback.js's completeConnectorCallback(),
// extracted specifically so it could be exercised with real execution
// (mocked store/providerAdapter, real call-order assertions, a real
// concurrent-duplicate race) instead of only source-text offsets -- see
// server/test/provider-callback.test.js for that direct coverage, including
// the exact race this fixes: two concurrent deliveries of the same signed
// attempt, one paused mid-completeCallback(), must still result in exactly
// one provider code exchange, exactly one finalizeConnection() call, and
// both callbacks resolving to the same success outcome. What remains
// checkable at the server.js boundary is only that server.js itself no
// longer inlines any of that logic (a regression guard against someone
// re-inlining it insecurely later) and that its result is always turned into
// a redirect -- covered by the test above and by
// provider-callback-boundary.test.js.
test('the provider callback route no longer inlines nonce-claim/completeCallback/finalizeConnection sequencing directly -- that now lives in completeConnectorCallback()', () => {
  const callbackStart = serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')")
  const callbackRoute = serverSource.slice(
    callbackStart,
    serverSource.indexOf("send(response, 404, { error: { code: 'not_found'", callbackStart),
  )
  assert.doesNotMatch(callbackRoute, /providerAdapter\(provider\)\.completeCallback\(/, 'completeCallback() must be invoked from inside completeConnectorCallback(), never directly from the route handler')
  assert.doesNotMatch(callbackRoute, /store\.finalizeConnection\(/, 'finalizeConnection() must be invoked from inside completeConnectorCallback(), never directly from the route handler')
  assert.doesNotMatch(callbackRoute, /store\.(?:consume|claim)PendingConnectionSetup\(/, 'nonce claiming must happen inside completeConnectorCallback(), never directly from the route handler')
  assert.match(callbackRoute, /await completeConnectorCallback\(/)
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
  const completeCall = callbackRoute.indexOf('await completeConnectorCallback(')
  const successBlock = callbackRoute.slice(completeCall)
  assert.match(successBlock, /completed\.outcome === 'error'/, 'the error branch must be checked before ever building the success redirect')
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

// Regression guard for the "connection disappears on ConnectionsPage
// remount" defect (2026-08-27, PR #154, seventh Mock ASPSP pass): a fresh
// mount had no way to list an already-persisted connector connection
// without triggering a real provider synchronization.
test('the stored-connections overview endpoint authenticates before reading any stored connection, and never triggers a provider sync', () => {
  const route = serverSource.slice(
    serverSource.indexOf("url.pathname === '/api/connectors/connections'"),
    serverSource.indexOf('const exclusionMatch'),
  )
  assert.ok(route.length > 0, 'the /api/connectors/connections route was not found')
  const authentication = route.indexOf('const user = userId(request)')
  const listCall = route.indexOf('listStoredConnections(user)')
  assert.ok(authentication >= 0 && listCall >= 0)
  assert.ok(authentication < listCall, 'must authenticate before listing stored connections')
  assert.doesNotMatch(route, /adapter\.sync\(/, 'listing existing connections must never trigger a provider synchronization')
})

test('listStoredConnections() is built from the same connection() summary buildSyncPayload() uses -- id/provider/displayName/status/lastSyncAt/consentExpiresAt/institutionId/error only, never a raw stored credential', () => {
  const helper = serverSource.slice(
    serverSource.indexOf('async function listStoredConnections(user)'),
    serverSource.indexOf('async function start(provider, request, response)'),
  )
  assert.match(helper, /connection\(provider, stored\)/, 'must reuse the vetted connection() summary helper')
  assert.doesNotMatch(helper, /\.\.\.stored\b/, 'must never spread the raw stored credential into the response')
})

// Regression guard for Dashboard's "Remove account" -> excludeProviderAccount()
// (2026-08-27, PR #154): the exclusion endpoint mutates a stored, encrypted
// connector credential, so it must authenticate/authorize and validate its
// input the same way every other connector-scoped route does.
test('the account-exclusion endpoint authenticates, authorizes, requires an existing stored connection, and validates the stable-account-id shape before ever writing to the store', () => {
  const route = serverSource.slice(
    serverSource.indexOf('const exclusionMatch = url.pathname.match'),
    serverSource.indexOf('// Restore ("un-remove")'),
  )
  assert.ok(route.length > 0, 'the /api/connectors/:provider/exclusions POST route was not found')
  const authentication = route.indexOf('const user = userId(request)')
  const authorization = route.indexOf('authorizeProviderUser(adapter, user, env)')
  const storedLookup = route.indexOf('const stored = await store.get(user, provider)')
  const notConnectedGuard = route.indexOf("throw new HttpError(404, 'connector_not_connected'")
  const shapeValidation = route.indexOf('isValidStableAccountId(stableAccountId)')
  const write = route.indexOf('await store.addAccountExclusion(user, provider,')
  assert.ok([authentication, authorization, storedLookup, notConnectedGuard, shapeValidation, write].every((index) => index >= 0))
  assert.ok(authentication < authorization, 'must authenticate before authorizing')
  assert.ok(authorization < storedLookup, 'must authorize before reading the stored connection')
  assert.ok(storedLookup < notConnectedGuard, 'must fail closed when no connection is stored for this provider')
  assert.ok(notConnectedGuard < shapeValidation, 'must confirm a connection exists before validating the request body')
  assert.ok(shapeValidation < write, 'must validate the stable-account-id shape before ever writing to the store')
  // Regression guard for BLOCKER 1 (2026-08-27, independent review): the
  // write must go through the durable, connection-independent
  // addAccountExclusion() store method (migration 011's
  // connector_account_exclusions table / EncryptedStore's own
  // accountExclusions), never a read-modify-write on this credential row
  // via store.set() -- that was the exact design that lost every exclusion
  // on disconnect/reconnect.
  assert.doesNotMatch(route, /store\.set\(user, provider,\s*\{\s*\.\.\.stored/, 'must never persist exclusions via a read-modify-write on the connector credential')
})

// Regression guard for the Restore ("un-remove") UX (2026-08-27, PR #154):
// removing a stable provider account must not be an irreversible hidden
// tombstone. Restore deliberately does not require re-authorizing a full
// sync -- it only deletes the durable exclusion record.
test('the account-restore endpoint authenticates and authorizes before deleting the exclusion, and never requires an active connector connection', () => {
  const route = serverSource.slice(
    serverSource.indexOf('const restoreMatch = url.pathname.match'),
    serverSource.indexOf('const institutionsMatch = url.pathname.match'),
  )
  assert.ok(route.length > 0, 'the /api/connectors/:provider/exclusions/:stableAccountId DELETE route was not found')
  assert.match(route, /request\.method === 'DELETE'/)
  const authentication = route.indexOf('const user = userId(request)')
  const authorization = route.indexOf('authorizeProviderUser(adapter, user, env)')
  const removal = route.indexOf('await store.removeAccountExclusion(user, provider, stableAccountId)')
  assert.ok([authentication, authorization, removal].every((index) => index >= 0))
  assert.ok(authentication < authorization && authorization < removal, 'must authenticate, then authorize, then delete the exclusion -- in that order')
  assert.doesNotMatch(route, /store\.get\(user, provider\)/, 'restore must not require an existing stored connector connection')
})

// Regression guard for the Restore UX's data source: the Connections page
// must be able to show excluded accounts without a second round trip or a
// new secret-exposure surface.
test('listStoredConnections() attaches excludedAccounts from the same durable store, never from the connector credential', () => {
  const helper = serverSource.slice(
    serverSource.indexOf('async function listStoredConnections(user)'),
    serverSource.indexOf('async function start(provider, request, response)'),
  )
  assert.match(helper, /store\.listAccountExclusions\(user, provider\)/)
  assert.match(helper, /excludedAccounts/)
})

// Regression guard for the "Restore list disappears after every sync"
// defect found by a second adversarial-review pass (2026-08-27, same day):
// ConnectionsPage.tsx's synchronize() unconditionally replaces its whole
// `connections` array with buildSyncPayload()'s response -- so unless every
// connection object THAT FUNCTION returns carries excludedAccounts too
// (not only listStoredConnections()'s mount-only overview), the
// Connections page's "Removed accounts / Restore" section would silently
// vanish immediately after any sync, even though the exclusion itself
// stayed fully enforced server-side. Both the success and the per-provider
// failure branch must carry it.
test('buildSyncPayload() attaches excludedAccounts to every connection object it returns, on both the success and failure branch', () => {
  const helper = serverSource.slice(
    serverSource.indexOf('async function buildSyncPayload(user)'),
    serverSource.indexOf('function syncIdempotencyKey'),
  )
  const exclusionsFetch = helper.indexOf('const excludedAccounts = await store.listAccountExclusions(user, provider)')
  const tryBlockStart = helper.indexOf('try {')
  const successPush = helper.indexOf('results.push({ connection: { ...connection(provider, stored), lastSyncAt, consentExpiresAt: synced.consentExpiresAt, excludedAccounts }')
  const failurePush = helper.indexOf('results.push({ connection: { ...connection(provider, stored, error instanceof Error ? error.message : \'Synchronization failed.\'), excludedAccounts }')
  assert.ok(exclusionsFetch >= 0 && successPush >= 0 && failurePush >= 0, 'excludedAccounts must be attached on both the success and failure branch')
  assert.ok(exclusionsFetch < tryBlockStart, 'excludedAccounts must be fetched outside (before) the try block, so it is available to both branches')
})

// Found by independent review (2026-08-27, PR #154, fourth review round):
// neither provider adapter sets institutionId on the accounts it returns,
// so a real bank import always produced Account.institutionId ===
// undefined. buildSyncPayload() must enrich the accounts it forwards to
// the browser with the STORED (server-validated at connection time)
// institutionId -- never a browser-supplied value read at sync time, which
// an attacker could otherwise use to suppress a legitimate
// unreconciledLegacyAccounts ambiguity warning. See withConnectionInstitutionId()
// in account-exclusions.js for the actual, directly-unit-tested mapping
// this line calls.
test('buildSyncPayload() enriches every returned account with the STORED connection institutionId, never a browser-supplied one', () => {
  const helper = serverSource.slice(
    serverSource.indexOf('async function buildSyncPayload(user)'),
    serverSource.indexOf('function syncIdempotencyKey'),
  )
  // buildSyncPayload(user) deliberately takes ONLY the authenticated user
  // id, never the raw HTTP request object -- so there is structurally no
  // `request` in scope here for institutionId (or anything else) to be
  // read from. This is what the exact match below actually proves: the
  // slice this test operates on begins at the literal text
  // `async function buildSyncPayload(user)`, so a signature accepting a
  // `request` parameter would already make that anchor -- and therefore
  // this whole test -- fail to find the right boundary.
  assert.match(helper, /withConnectionInstitutionId\(filtered\.accounts, stored\.institutionId\)/, 'accounts must be enriched from the already-authorized stored connection, not any per-sync-request input')
})
