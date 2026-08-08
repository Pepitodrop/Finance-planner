import { useState } from 'react'
import { ChevronLeft, Download } from 'lucide-react'
import { exportBackup } from '../backup'
import type { AppState } from '../types'

interface CreateBackupProps {
  state: AppState
  onBack: () => void
}

// DATA-02: local, one-shot AES-256-GCM export (backup.ts). No network call.
export function CreateBackup({ state, onBack }: CreateBackupProps) {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    setError(''); setMessage(''); setBusy(true)
    try {
      await exportBackup(state, password)
      setMessage('Backup created and downloaded.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The backup could not be created.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="data-tools-subpage" lang="en" data-data-ready="true">
    <button type="button" className="data-tools-back" onClick={onBack}><ChevronLeft size={18}/> Data and Backup</button>
    <h2>Create encrypted backup</h2>
    <p className="muted">This creates a password-protected file containing your accounts, transactions, and goals, encrypted on this device before it's saved. This password is separate from your vault password — Finance Planner cannot recover it if you lose it.</p>
    <div className="panel data-tools-form">
      <label>Backup password
        <input type="password" minLength={12} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)}/>
        <small>At least 12 characters.</small>
      </label>
      <button type="button" className="primary" disabled={busy || password.length < 12} onClick={() => void create()}>
        <Download size={17}/> Create and download backup
      </button>
      <p className="data-tools-hint">Store this password somewhere separate from the file itself — for example, a password manager. Without it, this specific backup file cannot be opened again, even by Finance Planner.</p>
      {message && <p className="status-message success-message" role="status">{message}</p>}
      {error && <p className="status-message error-message" role="alert">{error}</p>}
    </div>
  </div>
}
