import { HttpError } from './runtime-security.js'

function environmentKey(providerId, suffix) {
  return `${String(providerId).toUpperCase().replaceAll('-', '_')}_${suffix}`
}

export function providerOwnerUserId(providerDescription, env = process.env) {
  if (providerDescription?.mode !== 'owner') return null
  return String(env[environmentKey(providerDescription.id, 'OWNER_USER_ID')] || '').trim() || null
}

export function authorizeProviderUser(adapter, authenticatedUserId, env = process.env) {
  const description = adapter.describe()
  if (description.mode !== 'owner') return description

  const ownerUserId = providerOwnerUserId(description, env)
  if (!ownerUserId) {
    throw new HttpError(503, 'provider_owner_not_configured', `${description.displayName} owner-account access is not bound to an application user.`)
  }
  if (ownerUserId !== authenticatedUserId) {
    throw new HttpError(403, 'provider_owner_forbidden', `${description.displayName} owner-account access is not available for this user.`)
  }
  return description
}
