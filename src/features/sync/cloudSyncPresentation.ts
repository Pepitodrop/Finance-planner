import type { CloudSyncPhase } from '../../storage'

export function shouldDisplayCloudSyncStatus(phase: CloudSyncPhase): boolean {
  return phase !== 'synced'
}
