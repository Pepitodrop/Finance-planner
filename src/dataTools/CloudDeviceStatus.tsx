import { useEffect, useState } from 'react'
import { ChevronLeft, Cloud, CloudOff, Database, LoaderCircle, Smartphone } from 'lucide-react'
import { getCloudSyncStatus, subscribeCloudSyncStatus, type CloudSyncStatus as SyncStatus } from '../storage'

interface CloudDeviceStatusProps {
  onBack: () => void
}

const PHASE_TEXT: Record<Exclude<SyncStatus['phase'], 'conflict'>, string> = {
  syncing: 'Syncing…',
  synced: 'Up to date',
  offline: "Offline — changes will sync when you're back online",
  local: 'Not yet synced to your account',
  error: "Couldn't sync — see details below",
}

function formatRelativeTime(iso: string | undefined): string {
  if (!iso) return 'Not yet synced'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Not yet synced'
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// SYNC-01. The 'conflict' phase is deliberately never rendered here -- Step
// 11's VaultConflict (VAULT-04) owns that decision exclusively, same
// exclusion the ambient CloudSyncStatus banner already applies.
export function CloudDeviceStatus({ onBack }: CloudDeviceStatusProps) {
  const [status, setStatus] = useState<SyncStatus>(() => getCloudSyncStatus())
  useEffect(() => subscribeCloudSyncStatus(setStatus), [])

  const phase = status.phase === 'conflict' ? 'syncing' : status.phase
  const Icon = phase === 'syncing' ? LoaderCircle : phase === 'offline' || phase === 'local' ? CloudOff : phase === 'error' ? Cloud : Database

  return <div className="data-tools-subpage" lang="en" data-data-ready="true">
    <button type="button" className="data-tools-back" onClick={onBack}><ChevronLeft size={18}/> Data and Backup</button>
    <h2>Cloud and device data</h2>
    <div className="panel data-tools-sync-panel">
      <div className="data-tools-sync-row">
        <Smartphone size={18} aria-hidden="true"/>
        <span>This device</span>
        <strong className="data-tools-sync-value data-tools-sync-value--ok">Encrypted and unlocked</strong>
      </div>
      <div className="data-tools-sync-row" role="status" aria-live="polite">
        <Icon className={phase === 'syncing' ? 'spin' : ''} size={18} aria-hidden="true"/>
        <span>Your account</span>
        <strong className="data-tools-sync-value">{PHASE_TEXT[phase]}</strong>
      </div>
      <p className="data-tools-hint">Last synced: {formatRelativeTime(status.lastSyncedAt)}</p>
    </div>
    <p className="muted">Your data is encrypted on this device before anything is sent. The cloud copy lets you pick up on another device — it doesn't make your vault password recoverable if you lose it.</p>
    {status.phase === 'error' && <p className="status-message error-message" role="alert">{status.message}</p>}
  </div>
}
