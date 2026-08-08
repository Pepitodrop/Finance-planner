import { useState } from 'react'
import { ChevronLeft, FileKey2 } from 'lucide-react'
import { changeVaultPassword } from '../vault'

interface VaultPasswordChangeProps {
  onBack: () => void
}

// DATA-06: local-vault-password change. Never touches the network -- this
// is the local encrypted-vault secret, deliberately distinct from Google/
// passkey sign-in and from the exported-backup password (see DATA-02/09
// copy for those). A wrong current password is expected, correct behavior
// (changeVaultPassword re-derives and decrypts to verify it), not a bug.
export function VaultPasswordChange({ onBack }: VaultPasswordChangeProps) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [currentError, setCurrentError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setCurrentError(''); setConfirmError(''); setMessage('')
    if (next !== confirm) { setConfirmError("Doesn't match your new password."); return }
    setBusy(true)
    try {
      await changeVaultPassword(current, next)
      setCurrent(''); setNext(''); setConfirm('')
      setMessage('Vault password changed. Your local data was re-encrypted with a new key.')
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : 'The vault password could not be changed.'
      if (/current vault password is incorrect/i.test(text)) setCurrentError("That's not your current vault password.")
      else setConfirmError(text)
    } finally {
      setBusy(false)
    }
  }

  return <div className="data-tools-subpage" lang="en" data-data-ready="true">
    <button type="button" className="data-tools-back" onClick={onBack}><ChevronLeft size={18}/> Data and Backup</button>
    <h2>Change vault password</h2>
    <p className="muted">This is the password that unlocks your encrypted data on this device. It's separate from signing in to your account with Google or a passkey — changing it here doesn't affect your account sign-in at all, and this password is never sent to Finance Planner's servers.</p>
    <div className="panel data-tools-form">
      <label>Current vault password
        <input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)}/>
        {currentError && <span className="data-tools-field-error" role="alert">{currentError}</span>}
      </label>
      <label>New vault password
        <input type="password" minLength={12} autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)}/>
        <small>At least 12 characters.</small>
      </label>
      <label>Confirm new vault password
        <input type="password" minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)}/>
        {confirmError && <span className="data-tools-field-error" role="alert">{confirmError}</span>}
      </label>
      <button type="button" className="primary" disabled={busy || !current || next.length < 12} onClick={() => void submit()}>
        <FileKey2 size={17}/> Change vault password
      </button>
      {message && <p className="status-message success-message" role="status">{message}</p>}
    </div>
  </div>
}
