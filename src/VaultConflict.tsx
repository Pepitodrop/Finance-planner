import { useState } from 'react'
import { Cloud, GitBranch, HardDrive } from 'lucide-react'
import { useDialog } from './app/useDialog'
import { resolveCloudConflict } from './storage'

interface VaultConflictProps {
  onClose: () => void
}

/**
 * VAULT-04: replaces the old window.confirm()-gated resolution in
 * CloudSyncStatus. The two choices map exactly to resolveCloudConflict's two
 * real strategies (storage.ts) -- there is no merge, and the losing side is
 * genuinely replaced, not archived, so the copy says so plainly.
 */
export function VaultConflict({ onClose }: VaultConflictProps) {
  const [busy, setBusy] = useState<'server' | 'local' | null>(null)
  const [error, setError] = useState('')
  const dialogRef = useDialog<HTMLDivElement>({ open: true, onClose })

  async function resolve(strategy: 'server' | 'local') {
    setBusy(strategy)
    setError('')
    try {
      await resolveCloudConflict(strategy)
      window.location.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The conflict could not be resolved. Nothing was changed.')
      setBusy(null)
    }
  }

  return (
    <div className="vault-conflict-backdrop">
      <section ref={dialogRef} className="panel vault-conflict-card" role="dialog" aria-modal="true" aria-labelledby="vault-conflict-title" lang="en">
        <div className="goal-hero-icon"><GitBranch size={26}/></div>
        <p className="eyebrow">Data conflict</p>
        <h1 id="vault-conflict-title">Two versions of your data exist</h1>
        <p className="muted">This device has changes that have not been synced, and a different version is stored in the cloud for this account. Neither version has been changed automatically. Choose which one to keep: the other will be replaced with it.</p>
        {error && <p className="status-message error-message" role="alert">{error}</p>}
        <div className="vault-conflict-choices">
          <button type="button" className="vault-conflict-choice" disabled={busy !== null} onClick={() => void resolve('server')}>
            <Cloud size={18} aria-hidden="true"/>
            <span>
              <strong>{busy === 'server' ? 'Applying the cloud version…' : 'Use the cloud version'}</strong>
              <small>The cloud version replaces what is on this device. Unsynced local changes are lost.</small>
            </span>
          </button>
          <button type="button" className="vault-conflict-choice" disabled={busy !== null} onClick={() => void resolve('local')}>
            <HardDrive size={18} aria-hidden="true"/>
            <span>
              <strong>{busy === 'local' ? "Applying this device's version…" : "Keep this device's version"}</strong>
              <small>This device's data becomes the version stored in the cloud. The current cloud version is replaced.</small>
            </span>
          </button>
        </div>
        <p className="vault-conflict-footnote">This choice takes effect immediately.</p>
      </section>
    </div>
  )
}
