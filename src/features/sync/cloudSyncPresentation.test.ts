import { describe, expect, it } from 'vitest'
import { shouldDisplayCloudSyncStatus } from './cloudSyncPresentation'

describe('shouldDisplayCloudSyncStatus', () => {
  it('hides the settled synced state', () => {
    expect(shouldDisplayCloudSyncStatus('synced')).toBe(false)
  })

  it.each(['local', 'syncing', 'offline', 'conflict', 'error'] as const)('keeps %s visible', (phase) => {
    expect(shouldDisplayCloudSyncStatus(phase)).toBe(true)
  })
})
