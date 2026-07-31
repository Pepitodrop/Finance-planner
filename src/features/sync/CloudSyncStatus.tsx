import { useEffect, useState } from 'react'
import { AlertTriangle, CloudOff, Database, LoaderCircle, RefreshCw } from 'lucide-react'
import { getCloudSyncStatus, resolveCloudConflict, subscribeCloudSyncStatus, type CloudSyncStatus as SyncStatus } from '../../storage'

export function shouldDisplayCloudSyncStatus(phase: SyncStatus['phase']): boolean {
  return phase !== 'synced'
}

export function CloudSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(() => getCloudSyncStatus())
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeCloudSyncStatus(setStatus), [])

  async function resolve(strategy: 'server' | 'local') {
    const accepted = window.confirm(strategy === 'server'
      ? 'Den Serverstand verwenden? Nicht synchronisierte lokale Änderungen werden dabei verworfen.'
      : 'Den lokalen Stand als neuen Serverstand verwenden? Änderungen des anderen Geräts werden dabei ersetzt.')
    if (!accepted) return
    setBusy(true)
    try {
      await resolveCloudConflict(strategy)
      window.location.reload()
    } catch (error) {
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : 'Der Konflikt konnte nicht aufgelöst werden.' })
      setBusy(false)
    }
  }

  if (!shouldDisplayCloudSyncStatus(status.phase)) return null

  const Icon = status.phase === 'syncing' ? LoaderCircle
    : status.phase === 'offline' || status.phase === 'local' ? CloudOff
      : status.phase === 'conflict' || status.phase === 'error' ? AlertTriangle
        : Database
  const title = status.phase === 'syncing' ? 'Synchronisierung'
    : status.phase === 'conflict' ? 'Datenkonflikt'
      : status.phase === 'offline' ? 'Lokaler Modus'
        : status.phase === 'error' ? 'Speicherfehler'
          : 'Lokaler Speicher'

  return <aside className={`cloud-sync-status ${status.phase}`} role={status.phase === 'conflict' || status.phase === 'error' ? 'alert' : 'status'} aria-live="polite">
    <Icon className={status.phase === 'syncing' ? 'spin' : ''} size={17}/>
    <div><strong>{title}</strong><span>{status.message}</span></div>
    {status.phase === 'conflict' && <div className="cloud-sync-actions"><button type="button" disabled={busy} onClick={() => void resolve('server')}><RefreshCw size={14}/> Serverstand</button><button type="button" disabled={busy} onClick={() => void resolve('local')}><Database size={14}/> Lokalen Stand</button></div>}
  </aside>
}
