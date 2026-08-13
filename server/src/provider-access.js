import { HttpError } from './runtime-security.js'

function environmentKey(providerId, suffix) {
  return `${String(providerId).toUpperCase().replaceAll('-', '_')}_${suffix}`
}

export function providerOwnerUserId(providerDescription, env = process.env) {
  if (providerDescription?.mode !== 'owner') return null
  return String(env[environmentKey(providerDescription.id, 'OWNER_USER_ID')] || '').trim() || null
}

// Single source of truth for "can this authenticated user use this owner-mode
// provider" -- shared by authorizeProviderUser() (start/sync, throws) and
// describeProviderForUser() (listing, returns a sanitized descriptor) so the
// two paths cannot drift into disagreeing about who a provider is available
// to. Never includes the owner user id or any secret in its output.
function ownerAccessState(description, authenticatedUserId, env) {
  if (description.mode !== 'owner') return { ok: true }
  const ownerUserId = providerOwnerUserId(description, env)
  if (!ownerUserId) {
    return { ok: false, status: 503, code: 'provider_owner_not_configured', reason: `${description.displayName} owner connection is not configured for an application user.` }
  }
  if (ownerUserId !== authenticatedUserId) {
    return { ok: false, status: 403, code: 'provider_owner_forbidden', reason: `This ${description.displayName} owner connection is not available for this user.` }
  }
  return { ok: true }
}

export function authorizeProviderUser(adapter, authenticatedUserId, env = process.env) {
  const description = adapter.describe()
  const access = ownerAccessState(description, authenticatedUserId, env)
  if (!access.ok) throw new HttpError(access.status, access.code, access.reason)
  return description
}

// For GET /api/connectors: the same owner-access rule as authorizeProviderUser(),
// but returns a user-facing descriptor instead of throwing, so a non-owner
// (or a deployment with no owner binding configured) sees the provider as
// unavailable with a sanitized reason instead of only discovering it's
// forbidden after clicking through the setup flow and hitting a 403.
export function describeProviderForUser(adapter, authenticatedUserId, env = process.env) {
  const description = adapter.describe()
  const access = ownerAccessState(description, authenticatedUserId, env)
  if (access.ok) return description
  return { ...description, available: false, reason: access.reason }
}
