import { randomUUID } from 'node:crypto'
import { getActiveDatabasePool } from './database.js'
import { deleteGoogleSubscriptionsFromCloudState } from './google-subscription-data.js'
import {
  createGoogleSubscriptionAuthorizationUrl,
  exchangeGoogleSubscriptionCode,
  googleSubscriptionCapability,
  revokeGoogleSubscriptionAccess,
  syncGoogleSubscriptionSource,
} from './google-subscriptions-provider.js'
import { issueState, verifyState } from './security.js'
import { PostgresUserStateStore } from './user-state-store.js'

const PROVIDER = 'google-subscriptions'

function exactReturnUrl(value, origin) {
  const url = new URL(String(value || origin))
  if (url.origin !== origin) throw new Error('Invalid Google subscription return origin.')
  for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'connected']) url.searchParams.delete(key)
  return url.toString()
}

function deletionRequested(url, input) {
  if (typeof input?.deleteImportedData === 'boolean') return input.deleteImportedData
  return url.searchParams.get('deleteImportedData') === 'true'
}

export function createGoogleSubscriptionsRouter({
  env,
  origin,
  sessionSecret,
  store,
  send,
  body,
  userId,
  stateStore,
  adapter = {},
}) {
  const authorize = adapter.createAuthorizationUrl || createGoogleSubscriptionAuthorizationUrl
  const exchange = adapter.exchangeCode || exchangeGoogleSubscriptionCode
  const synchronize = adapter.syncSource || syncGoogleSubscriptionSource
  const revoke = adapter.revokeAccess || revokeGoogleSubscriptionAccess
  const capability = adapter.capability || googleSubscriptionCapability
  const callbackUri = `${origin}/api/subscriptions/google/callback`
  const activePool = getActiveDatabasePool()
  const cloudState = stateStore || (activePool ? new PostgresUserStateStore(activePool, env.CONNECTOR_MASTER_KEY || '') : null)

  return async function handleGoogleSubscriptions(request, response, url) {
    if (!url.pathname.startsWith('/api/subscriptions/google')) return false

    if (request.method === 'GET' && url.pathname === '/api/subscriptions/google/capability') {
      userId(request)
      const configured = capability(env)
      const stored = await store.get(userId(request), PROVIDER)
      send(response, 200, {
        ...configured,
        connected: stored?.status === 'connected',
        lastSyncAt: stored?.lastSyncAt,
      })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/subscriptions/google/start') {
      const user = userId(request)
      const input = await body(request)
      const returnUri = exactReturnUrl(input.redirectUri, origin)
      const consentId = randomUUID()
      const state = issueState(user, PROVIDER, sessionSecret, { consentId, redirectUri: returnUri })
      const claims = verifyState(state, PROVIDER, sessionSecret)
      const currentCapability = capability(env)
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
          source: currentCapability.source,
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      })
      send(response, 200, { redirectUrl, capability: currentCapability })
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
      const currentCapability = capability(env)
      await store.set(state.sub, PROVIDER, {
        ...credential,
        consentId: state.consentId,
        redirectUri: state.redirectUri,
        callbackUri,
        source: currentCapability.source,
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
      const currentCapability = capability(env)
      const stored = await store.get(user, PROVIDER)
      if (!stored || stored.status !== 'connected') {
        send(response, 200, {
          connected: false,
          subscriptions: [],
          capability: currentCapability,
          source: currentCapability.source,
          limitations: currentCapability.limitations || [],
          unavailableReason: currentCapability.reason || 'not_connected',
        })
        return true
      }
      const result = await synchronize(stored, env)
      const lastSyncAt = result.lastSyncAt || new Date().toISOString()
      await store.set(user, PROVIDER, {
        ...stored,
        ...(result.credential || {}),
        source: result.source || currentCapability.source,
        subscriptions: result.subscriptions,
        limitations: result.limitations || currentCapability.limitations || [],
        lastSyncAt,
        status: 'connected',
      })
      send(response, 200, {
        connected: true,
        lastSyncAt,
        source: result.source || currentCapability.source,
        limitations: result.limitations || currentCapability.limitations || [],
        capability: currentCapability,
        subscriptions: result.subscriptions,
      })
      return true
    }

    if (request.method === 'DELETE' && url.pathname === '/api/subscriptions/google') {
      const user = userId(request)
      const input = await body(request)
      const deleteImportedData = deletionRequested(url, input)
      const stored = await store.get(user, PROVIDER)
      let revoked = false
      if (stored) revoked = await revoke(stored, env)

      const deletion = deleteImportedData
        ? await deleteGoogleSubscriptionsFromCloudState(user, cloudState)
        : { deleted: 0, persisted: false, reason: 'not_requested' }

      await store.remove(user, PROVIDER)
      send(response, 200, {
        disconnected: true,
        revoked,
        deletedImportedData: deleteImportedData,
        deletedSubscriptionCount: deletion.deleted,
        cloudStateUpdated: deletion.persisted,
      })
      return true
    }

    send(response, 404, { error: { code: 'not_found', message: 'Not found.' } })
    return true
  }
}
