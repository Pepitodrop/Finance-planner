import { useEffect, useState } from 'react'
import { AlertTriangle, CloudOff, Database, LoaderCircle } from 'lucide-react'
import { getCloudSyncStatus, subscribeCloudSyncStatus, type CloudSyncStatus as SyncStatus } from '../../storage'
import { shouldDisplayCloudSyncStatus } from './cloudSyncPresentation'
import { RUNTIME_SURFACE_PRIORITY } from '../../runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from '../../runtime-surfaces/runtimeSurfaceContext'

/**
 * Ambient, non-blocking sync status. The 'conflict' phase is intentionally
 * NOT rendered here -- VaultGate owns that as a full-screen VaultConflict
 * dialog (VAULT-04), since a binary "which version wins" decision deserves
 * more than a small inline banner and a window.confirm().
 */
export function CloudSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(() => getCloudSyncStatus())

  useEffect(() => subscribeCloudSyncStatus(setStatus), [])

  const display = shouldDisplayCloudSyncStatus(status.phase) && status.phase !== 'conflict'
  const critical = status.phase === 'error'
  const visible = useRuntimeSurface(runtimeSurfaceRegistration(
    'cloud-sync',
    display,
    critical ? RUNTIME_SURFACE_PRIORITY.critical : RUNTIME_SURFACE_PRIORITY.informational,
    { blocksLower: true },
  ))

  if (!visible) return null

  const Icon = status.phase === 'syncing' ? LoaderCircle
    : status.phase === 'offline' || status.phase === 'local' ? CloudOff
      : status.phase === 'error' ? AlertTriangle
        : Database
  const title = status.phase === 'syncing' ? 'Syncing'
    : status.phase === 'offline' ? 'Local mode'
      : status.phase === 'error' ? 'Storage error'
        : 'Local storage'

  return <aside className={`cloud-sync-status runtime-surface ${critical ? 'runtime-surface--critical' : 'runtime-surface--informational'} ${status.phase}`} role={critical ? 'alert' : 'status'} aria-live="polite" lang="en">
    <Icon className={status.phase === 'syncing' ? 'spin' : ''} size={17}/>
    <div><strong>{title}</strong><span>{status.message}</span></div>
  </aside>
}
