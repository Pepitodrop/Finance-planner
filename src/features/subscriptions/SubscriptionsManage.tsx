import { useState } from 'react'
import { ChevronLeft, Unlink } from 'lucide-react'
import { ConfirmationDialog } from '../../app/ConfirmationDialog'
import { disconnectGoogleSubscriptions, type GoogleSubscriptionConnection } from '../../googleSubscriptions'
import type { AppState, Subscription } from '../../types'
import { formatRelativeTime } from './format'

interface SubscriptionsManageProps {
  state: AppState
  onApply: (state: AppState) => void
  connection: GoogleSubscriptionConnection | null
  googleSubscriptions: Subscription[]
  onBack: () => void
  onDisconnected: () => void
}

type ConfirmKind = 'keep' | 'remove' | null

// SUB-07: the two real, distinct disconnect outcomes the server supports
// (see DELETE /api/subscriptions/google's deleteImportedData boolean),
// presented as two equally-visible choices rather than a toggle -- neither
// is the "normal" option and the other "advanced".
export function SubscriptionsManage({ state, onApply, connection, googleSubscriptions, onBack, onDisconnected }: SubscriptionsManageProps) {
  const [confirmKind, setConfirmKind] = useState<ConfirmKind>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const count = googleSubscriptions.length

  const runDisconnect = async (deleteImportedData: boolean) => {
    setBusy(true)
    setError('')
    try {
      const result = await disconnectGoogleSubscriptions(deleteImportedData)
      if (!result.disconnected) throw new Error("Couldn't disconnect. Try again.")
      if (deleteImportedData) {
        onApply({ ...state, subscriptions: (state.subscriptions ?? []).filter((subscription) => subscription.source !== 'google') })
      }
      setConfirmKind(null)
      setMessage(deleteImportedData ? `Disconnected. ${result.deletedSubscriptionCount} subscription${result.deletedSubscriptionCount === 1 ? '' : 's'} removed.` : 'Disconnected.')
      onDisconnected()
    } catch {
      // Leave the connection state as last-known -- don't assume disconnected
      // client-side unless the server actually confirmed it.
      setError("Couldn't disconnect. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return <div className="subscriptions-page" lang="en" data-subscriptions-ready="true">
    <button type="button" className="data-tools-back" onClick={onBack}><ChevronLeft size={18}/> Subscriptions</button>
    <h2>Manage connection</h2>

    <div className="panel subscriptions-manage-summary">
      <span className="subscriptions-status-dot" aria-hidden="true"/>
      <span>Connected to Google · Last synced: {formatRelativeTime(connection?.lastSyncAt)}</span>
    </div>

    {message && <p className="status-message success-message" role="status">{message}</p>}
    {error && <p className="status-message error-message" role="alert">{error}</p>}

    <div className="subscriptions-manage-options">
      <article className="panel subscriptions-manage-option">
        <h3>Disconnect, keep imported data</h3>
        <p>Removes the Google connection. Subscriptions already imported stay visible, but won't update anymore.</p>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmKind('keep')}><Unlink size={16}/> Disconnect and keep data</button>
      </article>
      <article className="panel subscriptions-manage-option subscriptions-manage-option--remove">
        <h3>Disconnect and remove imported data</h3>
        <p>Removes the Google connection and deletes the {count} subscription{count === 1 ? '' : 's'} imported from it. Recurring Payments detected from your own transactions are never affected by this.</p>
        <button type="button" disabled={busy} onClick={() => setConfirmKind('remove')}><Unlink size={16}/> Disconnect and remove data</button>
      </article>
    </div>

    <ConfirmationDialog
      open={confirmKind === 'keep'}
      severity="warning"
      heading="Disconnect Google Subscriptions?"
      headingId="subscriptions-disconnect-keep-title"
      confirmLabel="Disconnect"
      busy={busy}
      onConfirm={() => void runDisconnect(false)}
      onClose={() => setConfirmKind(null)}
    >
      <p>You can reconnect any time. Imported subscriptions will stay, but stop updating.</p>
    </ConfirmationDialog>

    <ConfirmationDialog
      open={confirmKind === 'remove'}
      severity="warning"
      heading={`Disconnect and remove ${count} imported subscription${count === 1 ? '' : 's'}?`}
      headingId="subscriptions-disconnect-remove-title"
      confirmLabel="Disconnect and remove"
      busy={busy}
      onConfirm={() => void runDisconnect(true)}
      onClose={() => setConfirmKind(null)}
    >
      <p>This can't be undone, but you can reconnect and re-import later. Your Recurring Payments are not affected.</p>
    </ConfirmationDialog>
  </div>
}
