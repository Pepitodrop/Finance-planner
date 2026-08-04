import { StateVersionConflictError } from './user-state-store.js'

const GOOGLE_SOURCE = 'google'
const MAX_SAVE_ATTEMPTS = 3

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGoogleSubscription(value) {
  if (!isRecord(value)) return false
  return value.source === GOOGLE_SOURCE
    || String(value.id || '').startsWith('google:')
    || String(value.externalId || '').startsWith('google:')
}

function filterSubscriptions(value) {
  if (!Array.isArray(value)) return { value, deleted: 0 }
  const kept = value.filter((entry) => !isGoogleSubscription(entry))
  return { value: kept, deleted: value.length - kept.length }
}

export function removeGoogleSubscriptionsFromPayload(payload) {
  if (!isRecord(payload) || !isRecord(payload.state) || !isRecord(payload.secureData)) {
    throw new Error('Cloud finance payload is invalid.')
  }

  const next = structuredClone(payload)
  let deleted = 0

  if (Array.isArray(next.state.subscriptions)) {
    const filtered = filterSubscriptions(next.state.subscriptions)
    next.state.subscriptions = filtered.value
    deleted += filtered.deleted
  }

  for (const key of ['subscriptions', 'googleSubscriptions']) {
    const filtered = filterSubscriptions(next.secureData[key])
    if (filtered.deleted > 0) next.secureData[key] = filtered.value
    deleted += filtered.deleted
  }

  return { payload: next, deleted, changed: deleted > 0 }
}

export async function deleteGoogleSubscriptionsFromCloudState(userId, stateStore) {
  if (!stateStore) return { deleted: 0, persisted: false, reason: 'cloud_state_unavailable' }

  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    const current = await stateStore.get(userId)
    if (!current.payload) return { deleted: 0, persisted: true, version: current.version }

    const result = removeGoogleSubscriptionsFromPayload(current.payload)
    if (!result.changed) return { deleted: 0, persisted: true, version: current.version }

    try {
      const saved = await stateStore.save(userId, result.payload, current.version)
      return { deleted: result.deleted, persisted: true, version: saved.version, updatedAt: saved.updatedAt }
    } catch (error) {
      if (!(error instanceof StateVersionConflictError) || attempt === MAX_SAVE_ATTEMPTS - 1) throw error
    }
  }

  throw new Error('Google subscription data deletion could not be persisted.')
}
