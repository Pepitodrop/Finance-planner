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

test('connector deletion authenticates before validating a provider identifier', () => {
  const disconnectRoute = serverSource.slice(
    serverSource.indexOf("if (request.method === 'DELETE' && disconnect)"),
    serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')"),
  )
  assert.ok(disconnectRoute.indexOf('const user = userId(request)') < disconnectRoute.indexOf('providerAdapter(disconnect[1])'))
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
