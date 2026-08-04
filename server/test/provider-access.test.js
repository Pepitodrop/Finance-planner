import assert from 'node:assert/strict'
import test from 'node:test'
import { authorizeProviderUser, providerOwnerUserId } from '../src/provider-access.js'

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
