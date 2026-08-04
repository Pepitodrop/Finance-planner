import { randomUUID } from 'node:crypto'
import {
  createGoogleSubscriptionAuthorizationUrl,
  exchangeGoogleSubscriptionCode,
  googleSubscriptionCapability,
  revokeGoogleSubscriptionAccess,
  syncGoogleSubscriptionSource,
} from './google-subscriptions-provider.js'
import { issueState, verifyState } from './security.js'

const PROVIDER = 'google-subscriptions'

function exactReturnUrl(value, origin) {
  const url = new URL(String(value || origin))
  if (url.origin !== origin) throw new Error('Invalid Google subscription return origin.')
  for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'connected']) url.searchParams.delete(key)
  return url.toString()
}

export function createGoogleSubscriptionsRouter({
  env,
  origin,
  sessionSecret,
  store,
  send,
  body,
  userId,
  adapter = {},
}) {
  const authorize = adapter.createAuthorizationUrl || createGoogleSubscriptionAuthorizationUrl
  const exchange = adapter.exchangeCode || exchangeGoogleSubscriptionCode
  const synchronize = adapter.syncSource || syncGoogleSubscriptionSource
  const revoke = adapter.revokeAccess || revokeGoogleSubscriptionAccess
  const capability = adapter.capability || googleSubscriptionCapability
  const callbackUri = `${origin}/api/subscriptions/google/callback`

  return async function handleGoogleSubscriptions(request, response, url) {
    if (!url.pathname.startsWith('/api/subscriptions/google')) return false

    if (request.method === 'POST' && url.pathname === '/api/subscriptions/google/start') {
      const user = userId(request)
      const input = await body(request)
      const returnUri = exactReturnUrl(input.redirectUri, origin)
      const consentId = randomUUID()
      const state = issueState(user, PROVIDER, sessionSecret, { consentId, redirectUri: returnUri })
      const claims = verifyState(state, PROVIDER, sessionSecret)
      const redirectUrl = authorize({ env, state, redirectUri: callbackUri })
      await store.createConnectionSetup({
        userId: user,
        provider: PROVIDER,
        consentId,
        redirectUri: returnUri,
        nonce: claims.nonce,
        expiresAt: claims.exp * 1000,
        connection: {
          consentId,
          redirectUri: returnUri,
          callbackUri,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      })
      send(response, 200, { redirectUrl, capability: capability(env) })
      return true
    }

    if (request.method === 'GET' && url.pathname === '/api/subscriptions/google/callback') {
      const state = verifyState(url.searchParams.get('state'), PROVIDER, sessionSecret)
      const currentUser = userId(request)
      if (currentUser !== state.sub || !state.consentId || !state.redirectUri) throw new Error('Google subscription callback state does not match the active user.')
      if (url.searchParams.get('error')) throw new Error(`Google subscription authorization failed: ${url.searchParams.get('error')}`)
      const code = String(url.searchParams.get('code') || '')
      if (!code) throw new Error('Google subscription authorization code is missing.')
      const consumed = await store.consumeOAuthNonce({
        nonce: state.nonce,
        consentId: state.consentId,
        userId: state.sub,
        provider: PROVIDER,
        redirectUri: state.redirectUri,
        now: Date.now(),
      })
      if (!consumed) throw new Error('Google subscription state was already used, expired, or does not match.')
      const credential = await exchange({ env, code, redirectUri: callbackUri })
      await store.set(state.sub, PROVIDER, {
        ...credential,
        consentId: state.consentId,
        redirectUri: state.redirectUri,
        callbackUri,
        status: 'connected',
        connectedAt: new Date().toISOString(),
      })
      const destination = new URL(state.redirectUri)
      destination.searchParams.set('provider', PROVIDER)
      destination.searchParams.set('connected', '1')
      response.writeHead(302, { Location: destination.toString(), 'Cache-Control': 'no-store' })
      response.end()
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/subscriptions/google/sync') {
      const user = userId(request)
      const stored = await store.get(user, PROVIDER)
      if (!stored || stored.status !== 'connected') {
        send(response, 200, { connected: false, subscriptions: [], unavailableReason: capability(env).reason || 'not_connected' })
        return true
      }
      const result = await synchronize(stored, env)
      const lastSyncAt = result.lastSyncAt || new Date().toISOString()
      await store.set(user, PROVIDER, {
        ...stored,
        ...(result.credential || {}),
        subscriptions: result.subscriptions,
        lastSyncAt,
        status: 'connected',
      })
      send(response, 200, { connected: true, lastSyncAt, subscriptions: result.subscriptions })
      return true
    }

    if (request.method === 'DELETE' && url.pathname === '/api/subscriptions/google') {
      const user = userId(request)
      const input = await body(request)
      const stored = await store.get(user, PROVIDER)
      let revoked = false
      if (stored) revoked = await revoke(stored, env)
      await store.remove(user, PROVIDER)
      send(response, 200, { disconnected: true, revoked, deletedImportedData: Boolean(input.deleteImportedData) })
      return true
    }

    send(response, 404, { error: { code: 'not_found', message: 'Not found.' } })
    return true
  }
}
