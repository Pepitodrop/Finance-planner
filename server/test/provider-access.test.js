import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeProviderUser, describeProviderForUser, providerOwnerUserId } from '../src/provider-access.js'

function adapter(description) {
  return { describe: () => ({ id: 'paypal', displayName: 'PayPal', ...description }) }
}

test('non-owner providers are available to any authenticated user', () => {
  const description = authorizeProviderUser(adapter({ mode: 'partner', configured: true }), 'user-1', {})
  assert.equal(description.mode, 'partner')
  assert.equal(providerOwnerUserId(description, {}), null)
})

test('owner-account providers fail closed without an explicit user binding', () => {
  assert.throws(
    () => authorizeProviderUser(adapter({ mode: 'owner', configured: true }), 'user-1', {}),
    (error) => error.status === 503 && error.code === 'provider_owner_not_configured',
  )
})

test('owner-account providers reject every user except the configured owner', () => {
  const env = { PAYPAL_OWNER_USER_ID: 'owner-user' }
  assert.throws(
    () => authorizeProviderUser(adapter({ mode: 'owner', configured: true }), 'other-user', env),
    (error) => error.status === 403 && error.code === 'provider_owner_forbidden',
  )
  const description = authorizeProviderUser(adapter({ mode: 'owner', configured: true }), 'owner-user', env)
  assert.equal(description.mode, 'owner')
  assert.equal(providerOwnerUserId(description, env), 'owner-user')
})

// describeProviderForUser() backs GET /api/connectors and must apply the
// exact same owner-access rule as authorizeProviderUser() (start/sync) so
// the listing endpoint can't tell a non-owner user that a provider they are
// actually forbidden from using is available/configured.
test('describeProviderForUser: partner mode is not owner-gated', () => {
  const description = describeProviderForUser(adapter({ mode: 'partner', available: true, configured: true }), 'user-1', {})
  assert.equal(description.available, true)
  assert.equal(description.configured, true)
  assert.equal(description.reason, undefined)
})

test('describeProviderForUser: owner user sees the real provider state', () => {
  const env = { PAYPAL_OWNER_USER_ID: 'owner-user' }
  const description = describeProviderForUser(adapter({ mode: 'owner', available: true, configured: true }), 'owner-user', env)
  assert.equal(description.available, true)
  assert.equal(description.configured, true)
  assert.equal(description.reason, undefined)
})

test('describeProviderForUser: a non-owner authenticated user sees the provider as unavailable with a sanitized reason', () => {
  const env = { PAYPAL_OWNER_USER_ID: 'owner-user' }
  const description = describeProviderForUser(adapter({ mode: 'owner', available: true, configured: true }), 'other-user', env)
  assert.equal(description.available, false)
  assert.equal(description.reason, 'This PayPal owner connection is not available for this user.')
  assert.doesNotMatch(JSON.stringify(description), /owner-user/, 'must never leak the configured owner user id')
})

test('describeProviderForUser: a missing owner binding makes the provider unavailable for every user, with no secret leak', () => {
  const description = describeProviderForUser(adapter({ mode: 'owner', available: true, configured: true }), 'any-user', {})
  assert.equal(description.available, false)
  assert.equal(description.reason, 'PayPal owner connection is not configured for an application user.')
  assert.doesNotMatch(JSON.stringify(description), /PAYPAL_OWNER_USER_ID/)
})

test('describeProviderForUser and authorizeProviderUser agree on who may use an owner-mode provider', () => {
  const env = { PAYPAL_OWNER_USER_ID: 'owner-user' }
  const forbidden = adapter({ mode: 'owner', available: true, configured: true })
  assert.throws(() => authorizeProviderUser(forbidden, 'other-user', env), (error) => error.status === 403)
  assert.equal(describeProviderForUser(forbidden, 'other-user', env).available, false)

  const allowed = adapter({ mode: 'owner', available: true, configured: true })
  assert.doesNotThrow(() => authorizeProviderUser(allowed, 'owner-user', env))
  assert.equal(describeProviderForUser(allowed, 'owner-user', env).available, true)
})
