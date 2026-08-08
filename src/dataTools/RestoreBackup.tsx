import { useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, Upload } from 'lucide-react'
import { importBackup } from '../backup'
import type { AppState } from '../types'

interface RestoreBackupProps {
  onRestore: (state: AppState) => void
  onBack: () => void
  // Fixture-only: deterministically show DATA-04 (restore failure) without
  // a real file/crypto round trip. Never set outside VITE_ACCEPTANCE_FIXTURES.
  acceptanceShowFailure?: boolean
}

// DATA-03/04: importBackup() validates file size, JSON shape, envelope
// format, and (via AES-GCM's auth tag + isAppState) the decrypted payload,
// entirely before this component's onRestore ever runs -- nothing here
// applies a state change speculatively. The crypto layer can't distinguish
// "wrong password" from "corrupted ciphertext" (that's what an
// authenticated cipher is for), so that specific failure is shown as one
// honest combined message rather than a fabricated, more specific claim.
export function RestoreBackup({ onRestore, onBack, acceptanceShowFailure }: RestoreBackupProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  // The fixture's synthetic File never touches importBackup() -- it only
  // exists so the failure screen's "file already chosen" layout renders
  // deterministically, matching what a real failed attempt looks like.
  const [file, setFile] = useState<File | null>(acceptanceShowFailure ? new File([], 'finance-planner-backup-2026-08-01.fpbackup') : null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState(acceptanceShowFailure ? "Wrong password, or the backup file is corrupted." : '')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const chooseFile = () => inputRef.current?.click()

  const chooseAnother = () => {
    setFile(null)
    setPassword('')
    setError('')
    if (inputRef.current) inputRef.current.value = ''
    inputRef.current?.click()
  }

  const restore = async () => {
    if (!file) return
    setError(''); setMessage(''); setBusy(true)
    try {
      const restored = await importBackup(file, password)
      onRestore(restored)
      setMessage("Backup restored. Your data here now matches the backup, and it's syncing to your account.")
      setFile(null)
      setPassword('')
      if (inputRef.current) inputRef.current.value = ''
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The backup could not be restored.')
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return <div className="data-tools-subpage" lang="en" data-data-ready="true">
    <button type="button" className="data-tools-back" onClick={onBack}><ChevronLeft size={18}/> Data and Backup</button>
    <h2>Restore from backup</h2>
    <div className="panel data-tools-form">
      {error && <div className="data-tools-alert" role="alert">
        <AlertTriangle size={20}/>
        <div>
          <strong>Couldn't restore this backup.</strong>
          <p>{error}</p>
          <p>Nothing on this device has changed.</p>
        </div>
      </div>}
      <label className="data-tools-file-picker">
        Backup file
        <input ref={inputRef} hidden type="file" accept=".fpbackup,application/octet-stream" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError('') }}/>
        <button type="button" className="secondary" onClick={chooseFile}>
          <Upload size={17}/> {file ? file.name : 'Choose a .fpbackup file'}
        </button>
        <small>Accepted files are up to 10 MB.</small>
      </label>
      <label>Backup password
        <input type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)}/>
      </label>
      <p className="data-tools-hint">Finance Planner checks the file and password first. If anything doesn't match, nothing on this device changes. If it checks out, your current accounts, transactions, and goals here are replaced by the backup's contents, and the restored data is then synced to your account.</p>
      {error
        ? <div className="data-tools-restore-actions">
            <button type="button" className="primary" disabled={busy || !file || !password} onClick={() => void restore()}>Try again</button>
            <button type="button" className="secondary" onClick={chooseAnother}>Choose another file</button>
          </div>
        : <button type="button" className="primary" disabled={busy || !file || !password} onClick={() => void restore()}>
            <Upload size={17}/> Restore backup
          </button>}
      {message && <p className="status-message success-message" role="status">{message}</p>}
    </div>
  </div>
}
