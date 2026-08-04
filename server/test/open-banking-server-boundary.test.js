import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8')

test('connector setup authenticates before disclosing provider availability or configuration', () => {
  const startFunction = serverSource.slice(
    serverSource.indexOf('async function start(provider, request, response)'),
    serverSource.indexOf('async function buildSyncPayload'),
  )
  const authentication = startFunction.indexOf('const user = userId(request)')
  const providerLookup = startFunction.indexOf('const adapter = providerAdapter(provider)')
  const capabilityDescription = startFunction.indexOf('const description = adapter.describe()')
  assert.ok(authentication >= 0)
  assert.ok(authentication < providerLookup)
  assert.ok(authentication < capabilityDescription)
})

test('connector deletion authenticates before validating a provider identifier', () => {
  const disconnectRoute = serverSource.slice(
    serverSource.indexOf("if (request.method === 'DELETE' && disconnect)"),
    serverSource.indexOf("if (request.method === 'GET' && url.pathname === '/api/connectors/callback')"),
  )
  assert.ok(disconnectRoute.indexOf('const user = userId(request)') < disconnectRoute.indexOf('providerAdapter(disconnect[1])'))
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
