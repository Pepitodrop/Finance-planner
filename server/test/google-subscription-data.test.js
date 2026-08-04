import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteGoogleSubscriptionsFromCloudState, removeGoogleSubscriptionsFromPayload } from '../src/google-subscription-data.js'
import { StateVersionConflictError } from '../src/user-state-store.js'

const payload = {
  state: { accounts: [], transactions: [], goals: [] },
  secureData: {
    subscriptions: [
      { id: 'google:one', source: 'google', product: 'Google One' },
      { id: 'manual:one', source: 'manual', product: 'Gym' },
    ],
    googleSubscriptions: [
      { externalId: 'google:play-1', source: 'google', product: 'Play Pass' },
    ],
    preferences: { theme: 'dark' },
  },
}

test('removes only Google-imported subscriptions and preserves unrelated secure data', () => {
  const result = removeGoogleSubscriptionsFromPayload(payload)
  assert.equal(result.deleted, 2)
  assert.equal(result.changed, true)
  assert.deepEqual(result.payload.secureData.subscriptions, [{ id: 'manual:one', source: 'manual', product: 'Gym' }])
  assert.deepEqual(result.payload.secureData.googleSubscriptions, [])
  assert.deepEqual(result.payload.secureData.preferences, { theme: 'dark' })
  assert.equal(payload.secureData.subscriptions.length, 2)
})

test('persists deletion with optimistic versioning and retries one conflict', async () => {
  let version = 3
  let saveCalls = 0
  let stored = structuredClone(payload)
  const stateStore = {
    async get() { return { payload: structuredClone(stored), version, updatedAt: null } },
    async save(_userId, next, expectedVersion) {
      saveCalls += 1
      assert.equal(expectedVersion, version)
      if (saveCalls === 1) {
        version += 1
        throw new StateVersionConflictError(version)
      }
      stored = structuredClone(next)
      version += 1
      return { version, updatedAt: '2026-08-04T14:00:00.000Z' }
    },
  }

  const result = await deleteGoogleSubscriptionsFromCloudState('user-1', stateStore)
  assert.equal(result.deleted, 2)
  assert.equal(result.persisted, true)
  assert.equal(saveCalls, 2)
  assert.deepEqual(stored.secureData.subscriptions, [{ id: 'manual:one', source: 'manual', product: 'Gym' }])
})

test('reports unavailable cloud persistence without claiming deletion', async () => {
  assert.deepEqual(
    await deleteGoogleSubscriptionsFromCloudState('user-1', null),
    { deleted: 0, persisted: false, reason: 'cloud_state_unavailable' },
  )
})
