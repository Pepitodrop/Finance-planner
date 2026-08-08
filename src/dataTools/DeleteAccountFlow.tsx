import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { ConfirmationDialog } from '../app/ConfirmationDialog'
import { clearUnlockedState } from '../storage'
import { removeEncryptedVault } from '../vault'

interface DeleteAccountFlowProps {
  userId: string
  onBack: () => void
  onCreateBackup: () => void
  // Fixture-only: deterministically show DATA-10 (final dialog, open) or
  // DATA-11 (failure dialog, open) without a real DELETE request. Never set
  // outside VITE_ACCEPTANCE_FIXTURES.
  acceptanceView?: 'final' | 'failure'
}

export const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT'

function apiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message
  return fallback
}

function clearAccountDeviceMetadata(userId: string): void {
  const suffix = encodeURIComponent(userId)
  localStorage.removeItem(`finance-planner-cloud-conflict-v2:${suffix}`)
  localStorage.removeItem(`finance-planner-cloud-metadata-v1:${suffix}`)
}

// DATA-09/10/11: two-stage account deletion, replacing the old
// window.confirm()-gated flow. DATA-09 (this page) gates on the typed
// phrase; DATA-10 (a ConfirmationDialog) is the actual point of no return;
// DATA-11 (also a ConfirmationDialog, reusing the same component) is shown
// only if the DELETE call fails -- local cleanup (vault removal, device
// metadata, session storage) only ever runs after a confirmed-successful
// server response, never speculatively, matching account-deletion.js's own
// server-side rollback-on-failure guarantee.
export function DeleteAccountFlow({ userId, onBack, onCreateBackup, acceptanceView }: DeleteAccountFlowProps) {
  const [confirmation, setConfirmation] = useState(acceptanceView ? ACCOUNT_DELETE_CONFIRMATION : '')
  const [finalDialogOpen, setFinalDialogOpen] = useState(acceptanceView === 'final')
  const [failureDialogOpen, setFailureDialogOpen] = useState(acceptanceView === 'failure')
  const [error, setError] = useState(acceptanceView === 'failure' ? 'Account deletion did not complete.' : '')
  const [busy, setBusy] = useState(false)

  const phraseMatches = confirmation === ACCOUNT_DELETE_CONFIRMATION

  const runDeletion = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETE_CONFIRMATION }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || (payload as { deleted?: unknown }).deleted !== true) {
        throw new Error(apiError(payload, 'Account deletion did not complete.'))
      }
      clearUnlockedState()
      removeEncryptedVault(userId)
      clearAccountDeviceMetadata(userId)
      sessionStorage.clear()
      window.location.assign('/')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Account deletion did not complete.')
      setFinalDialogOpen(false)
      setFailureDialogOpen(true)
      setBusy(false)
    }
  }

  return <div className="data-tools-subpage data-tools-subpage--danger" lang="en" data-data-ready="true">
    <button type="button" className="data-tools-back" onClick={onBack}><ChevronLeft size={18}/> Data and Backup</button>
    <h2>Delete account</h2>
    <p>Deleting your account permanently removes:</p>
    <ul className="data-tools-danger-list">
      <li>Your encrypted financial data stored with your account</li>
      <li>Learned categorization and behavior patterns</li>
      <li>Bank, PayPal, and Google subscription connections stored with Finance Planner</li>
      <li>Registered passkeys and any pending sign-in requests</li>
      <li>Your account and sign-in itself — you'll be signed out everywhere immediately</li>
    </ul>
    <p className="muted">This removes Finance Planner's own copies of your connections. It doesn't reach into Google, your bank, or PayPal to revoke access on their side — disconnect those directly with the provider if you'd also like to revoke access there.</p>
    <p className="data-tools-irreversible"><strong>This cannot be undone.</strong></p>
    <button type="button" className="data-tools-link" onClick={onCreateBackup}>Consider creating an encrypted backup first →</button>
    <div className="panel data-tools-form">
      <label>Type <code>{ACCOUNT_DELETE_CONFIRMATION}</code> to confirm
        <input autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/>
      </label>
      <button type="button" className="primary" disabled={!phraseMatches} onClick={() => setFinalDialogOpen(true)}>
        Continue to final confirmation
      </button>
    </div>

    <ConfirmationDialog
      open={finalDialogOpen}
      severity="danger"
      role="alertdialog"
      heading="Permanently delete your account?"
      headingId="delete-account-final-title"
      confirmLabel={busy ? 'Deleting account…' : 'Delete account'}
      busy={busy}
      onConfirm={() => void runDeletion()}
      onClose={() => setFinalDialogOpen(false)}
    >
      <p>This immediately signs you out everywhere and permanently removes your Finance Planner account and its data. There's no way to undo this.</p>
    </ConfirmationDialog>

    <ConfirmationDialog
      open={failureDialogOpen}
      severity="danger"
      heading="Account deletion didn't complete."
      headingId="delete-account-failure-title"
      confirmLabel="Try again"
      cancelLabel="Close"
      onConfirm={() => { setFailureDialogOpen(false); setFinalDialogOpen(true) }}
      onClose={() => setFailureDialogOpen(false)}
    >
      <p>Something went wrong, and your account and data are still here — nothing was removed. You're still signed in.</p>
      {error && <p className="muted">{error}</p>}
      <p className="muted">You can try again, or come back to this later.</p>
    </ConfirmationDialog>
  </div>
}
