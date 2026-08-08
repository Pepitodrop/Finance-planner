import { useEffect, useState } from 'react'
import { DatabaseBackup, FileSpreadsheet, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { ConfirmationDialog } from './app/ConfirmationDialog'
import { CloudDeviceStatus } from './dataTools/CloudDeviceStatus'
import { CreateBackup } from './dataTools/CreateBackup'
import { DeleteAccountFlow } from './dataTools/DeleteAccountFlow'
import { RestoreBackup } from './dataTools/RestoreBackup'
import { VaultPasswordChange } from './dataTools/VaultPasswordChange'
import { exportTransactionsCsv } from './backup'
import { getCloudSyncStatus, subscribeCloudSyncStatus, type CloudSyncStatus as SyncStatus } from './storage'
import type { AppState } from './types'

interface DataToolsProps {
  userId: string
  state: AppState
  onRestore: (state: AppState) => void
  onReset: () => void
  acceptanceMode?: DataToolsAcceptanceMode
}

export type DataToolsAcceptanceMode =
  | 'vault-password'
  | 'create-backup'
  | 'restore-backup'
  | 'restore-failure'
  | 'reset'
  | 'csv-warning'
  | 'delete-account'
  | 'delete-account-final'
  | 'delete-failure'
  | 'cloud-sync'
  | 'sync-offline'
  | 'sync-error'

type DataToolsView = 'overview' | 'vault-password' | 'create-backup' | 'restore-backup' | 'delete-account' | 'cloud-sync'

const DELETE_ACCOUNT_MODES = new Set<DataToolsAcceptanceMode>(['delete-account', 'delete-account-final', 'delete-failure'])
const VIEW_MODES: Partial<Record<DataToolsAcceptanceMode, DataToolsView>> = {
  'vault-password': 'vault-password',
  'create-backup': 'create-backup',
  'restore-backup': 'restore-backup',
  'restore-failure': 'restore-backup',
  'cloud-sync': 'cloud-sync',
  'sync-offline': 'cloud-sync',
  'sync-error': 'cloud-sync',
}

const SYNC_SUMMARY: Record<Exclude<SyncStatus['phase'], 'conflict'>, string> = {
  syncing: 'Syncing…',
  synced: 'Synced',
  offline: 'Offline',
  local: 'Not synced',
  error: 'Sync error',
}

// DATA-01: Data & Backup overview. Reset (DATA-07/08) and the CSV plaintext
// warning (DATA-05) stay as dialogs launched from here, since neither needs
// its own sub-page; every other flow gets a focused sub-page (DataToolsView)
// matching the approved spec's explicit back-navigation between frames.
export function DataTools({ userId, state, onRestore, onReset, acceptanceMode }: DataToolsProps) {
  const [view, setView] = useState<DataToolsView>(() => {
    if (acceptanceMode && DELETE_ACCOUNT_MODES.has(acceptanceMode)) return 'delete-account'
    if (acceptanceMode && acceptanceMode in VIEW_MODES) return VIEW_MODES[acceptanceMode] ?? 'overview'
    return 'overview'
  })
  const [csvDialogOpen, setCsvDialogOpen] = useState(acceptanceMode === 'csv-warning')
  const [resetDialogOpen, setResetDialogOpen] = useState(acceptanceMode === 'reset')
  const [resetMessage, setResetMessage] = useState('')
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => {
    if (acceptanceMode === 'sync-offline') return { phase: 'offline', message: 'Waiting for a connection.' }
    if (acceptanceMode === 'sync-error') return { phase: 'error', message: 'The last save attempt failed. Your data is safe on this device.' }
    return getCloudSyncStatus()
  })

  useEffect(() => {
    // Fixture modes show a fixed, deterministic status instead of the real
    // (network-dependent) sync state, matching the guard convention already
    // used by AutomaticTransactionAnalysis's acceptance fixture.
    if (acceptanceMode) return
    return subscribeCloudSyncStatus(setSyncStatus)
  }, [acceptanceMode])

  const runReset = () => {
    onReset()
    setResetDialogOpen(false)
    setResetMessage('Your accounts, transactions, and goals now show Finance Planner’s example dataset. Add your own transactions any time — nothing here is permanent.')
  }

  const runCsvExport = () => {
    exportTransactionsCsv(state)
    setCsvDialogOpen(false)
  }

  if (view === 'vault-password') return <VaultPasswordChange onBack={() => setView('overview')}/>
  if (view === 'create-backup') return <CreateBackup state={state} onBack={() => setView('overview')}/>
  if (view === 'restore-backup') return <RestoreBackup onRestore={onRestore} onBack={() => setView('overview')} acceptanceShowFailure={acceptanceMode === 'restore-failure'}/>
  if (view === 'delete-account') return <DeleteAccountFlow
    userId={userId}
    onBack={() => setView('overview')}
    onCreateBackup={() => setView('create-backup')}
    acceptanceView={acceptanceMode === 'delete-account-final' ? 'final' : acceptanceMode === 'delete-failure' ? 'failure' : undefined}
  />
  if (view === 'cloud-sync') return <CloudDeviceStatus onBack={() => setView('overview')}/>

  const phase = syncStatus.phase === 'conflict' ? 'syncing' : syncStatus.phase

  return <div className="data-tools-page" lang="en" data-data-ready="true">
    <section className="panel assistant-hero data-tools-hero">
      <div><p className="eyebrow">Personal finance</p><h2>Data and Backup</h2><p>Your local vault and full backups are encrypted. Finance Planner keeps an encrypted, account-bound copy in the cloud. CSV files are for spreadsheets and stay plain text.</p></div>
      <ShieldCheck size={30}/>
    </section>

    <section className="panel data-tools-status-strip">
      <div>
        <span>Vault password</span>
        <button type="button" className="data-tools-link" onClick={() => setView('vault-password')}>Change</button>
      </div>
      <div>
        <span>{SYNC_SUMMARY[phase]}</span>
        <button type="button" className="data-tools-link" onClick={() => setView('cloud-sync')}>Cloud and device data →</button>
      </div>
    </section>

    <p className="data-tools-section-eyebrow">Backup &amp; export</p>
    <div className="data-tools-backup-row">
      <button type="button" className="panel data-tools-backup-card" onClick={() => setView('create-backup')}>
        <div className="goal-hero-icon"><DatabaseBackup size={22}/></div>
        <div><strong>Create encrypted backup</strong><span>Download an encrypted copy of your accounts, transactions, and goals.</span></div>
      </button>
      <button type="button" className="panel data-tools-backup-card" onClick={() => setView('restore-backup')}>
        <div className="goal-hero-icon"><Upload size={22}/></div>
        <div><strong>Restore from backup</strong><span>Import a previously created encrypted backup file.</span></div>
      </button>
    </div>
    <div className="data-tools-csv-row">
      <span className="data-tools-csv-row-label"><FileSpreadsheet size={18}/> Export as CSV (unencrypted)</span>
      <span className="data-tools-plaintext-tag">Plaintext</span>
      <button type="button" className="secondary" onClick={() => setCsvDialogOpen(true)}>Export</button>
    </div>

    <article className="panel data-tools-backup-card warning-card">
      <div className="goal-hero-icon"><RotateCcw size={22}/></div>
      <div>
        <p className="eyebrow">Reset</p>
        <strong>Reset financial data</strong>
        <span>Replace your accounts, transactions, goals, and learned patterns with Finance Planner's example dataset. Your account and sign-in stay.</span>
        <button type="button" className="secondary" onClick={() => setResetDialogOpen(true)}>Reset financial data</button>
      </div>
    </article>
    {resetMessage && <p className="status-message success-message" role="status">{resetMessage}</p>}

    <article className="panel data-tools-backup-card danger-card">
      <div className="goal-hero-icon"><Trash2 size={22}/></div>
      <div>
        <p className="eyebrow">Permanent</p>
        <strong>Delete account</strong>
        <span>Permanently remove your account and all associated data. This cannot be undone.</span>
        <button type="button" className="danger-action" onClick={() => setView('delete-account')}>Delete account</button>
      </div>
    </article>

    <ConfirmationDialog
      open={resetDialogOpen}
      severity="warning"
      heading="Reset financial data?"
      headingId="reset-financial-data-title"
      confirmLabel="Reset financial data"
      onConfirm={runReset}
      onClose={() => setResetDialogOpen(false)}
    >
      <p>This replaces your accounts, transactions, savings goals, and learned categorization patterns on this device with Finance Planner's example dataset, then syncs that change to your account and any other signed-in devices.</p>
      <p><strong>Replaced:</strong> accounts, transactions, goals, and learned patterns — with example data, not an empty state.</p>
      <p><strong>Kept:</strong> your account, sign-in, and any connected banks, PayPal, or Google subscriptions.</p>
    </ConfirmationDialog>

    <ConfirmationDialog
      open={csvDialogOpen}
      severity="warning"
      icon={FileSpreadsheet}
      heading="This file won't be encrypted."
      headingId="csv-export-title"
      confirmLabel="Export as CSV"
      onConfirm={runCsvExport}
      onClose={() => setCsvDialogOpen(false)}
      footer={<button type="button" className="data-tools-link" onClick={() => { setCsvDialogOpen(false); setView('create-backup') }}>Use encrypted backup instead</button>}
    >
      <p>CSV export creates a plain text file — anyone who can open it, or any other app with access to it on this device, can read your transaction data directly.</p>
      <p>Dates, descriptions, categories, and amounts are all readable as plain text. Save it only to a storage location and device you trust. For a protected copy, use encrypted backup instead.</p>
    </ConfirmationDialog>
  </div>
}
