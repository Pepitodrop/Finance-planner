import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Calendar, Check, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react'
import {
  normalizeGoogleSubscriptions,
  reconcileGoogleSubscriptions,
  startGoogleSubscriptionConnection,
  syncGoogleSubscriptions,
  type GoogleSubscriptionConnection,
} from '../../googleSubscriptions'
import type { AppState, Subscription } from '../../types'
import { formatMoney } from '../../finance'
import { formatRelativeTime, formatSubscriptionDate, INTERVAL_LABEL, STATUS_LABEL } from './format'
import { SubscriptionsManage } from './SubscriptionsManage'

interface SubscriptionsPageProps {
  state: AppState
  onApply: (state: AppState) => void
  acceptanceMode?: SubscriptionsAcceptanceMode
}

export type SubscriptionsAcceptanceMode = 'intro' | 'preflight' | 'connected' | 'syncing' | 'no-subscriptions' | 'unavailable' | 'subscription-sync-error' | 'manage'

type PageView = 'main' | 'preflight' | 'manage'

// Deterministic data for browser acceptance screenshots (SUB-03/04/05/06).
// Never a live Google connection -- see App.tsx's acceptance dispatcher.
const FIXTURE_SUBSCRIPTIONS: Subscription[] = [
  { id: 'google:yt-premium', externalId: 'yt-premium', provider: 'Google', product: 'YouTube Premium', amountCents: 1199, currency: 'EUR', billingInterval: 'monthly', nextChargeDate: '2026-09-12', status: 'active', source: 'google', lastSyncedAt: '2026-08-07T10:00:00.000Z' },
  { id: 'google:workspace', externalId: 'workspace', provider: 'Google', product: 'Google Workspace', amountCents: 699, currency: 'EUR', billingInterval: 'monthly', nextChargeDate: '2026-09-03', status: 'active', source: 'google', lastSyncedAt: '2026-08-07T10:00:00.000Z' },
  { id: 'google:play-pass', externalId: 'play-pass', provider: 'Google', product: 'Google Play Pass', amountCents: 499, currency: 'EUR', billingInterval: 'monthly', status: 'paused', source: 'google', lastSyncedAt: '2026-08-07T10:00:00.000Z' },
]

function StatusHeader({ lastSyncAt, syncing, onSync }: { lastSyncAt: string | undefined; syncing: boolean; onSync: () => void }) {
  return <div className="panel subscriptions-status-row" role="status" aria-live="polite">
    <span className="subscriptions-status-dot" aria-hidden="true"/>
    <div className="subscriptions-status-text">
      <strong>Connected to Google</strong>
      <span>Last synced: {formatRelativeTime(lastSyncAt)}</span>
    </div>
    {syncing ? (
      <span className="secondary subscriptions-sync-button" aria-disabled="true">
        <LoaderCircle className="spin" size={16}/> Syncing…
      </span>
    ) : (
      <button type="button" className="secondary subscriptions-sync-button" onClick={onSync}>
        <RefreshCw size={16}/> Sync now
      </button>
    )}
  </div>
}

function SubscriptionRow({ subscription }: { subscription: Subscription }) {
  return <li className="panel subscription-row">
    <div className="subscription-row-name">
      <strong>{subscription.product}</strong>
      <span className="subscription-source-badge">Synced from Google</span>
    </div>
    <span className={`pill subscription-row-status pill--${subscription.status}`}>{STATUS_LABEL[subscription.status]}</span>
    <span className="subscription-row-amount">{formatMoney(subscription.amountCents)} / {INTERVAL_LABEL[subscription.billingInterval]}</span>
    {subscription.nextChargeDate && <p className="subscription-row-next-charge"><Calendar size={13} aria-hidden="true"/> Next charge: {formatSubscriptionDate(subscription.nextChargeDate)}</p>}
  </li>
}

function SubscriptionsList({ subscriptions, lastSyncAt, syncing, onSync, onManage }: { subscriptions: Subscription[]; lastSyncAt: string | undefined; syncing: boolean; onSync: () => void; onManage: () => void }) {
  return <>
    <StatusHeader lastSyncAt={lastSyncAt} syncing={syncing} onSync={onSync}/>
    <ul className="subscriptions-list">
      {subscriptions.map((subscription) => <SubscriptionRow key={subscription.id} subscription={subscription}/>)}
    </ul>
    <p className="subscriptions-list-footer">These are billing records from your connected Google account, not bank transactions.</p>
    <button type="button" className="subscriptions-manage-link" onClick={onManage}>Manage connection →</button>
  </>
}

function IntroPanel({ onContinue }: { onContinue: () => void }) {
  return <div className="subscriptions-intro">
    <div className="subscriptions-intro-icon" aria-hidden="true"><RefreshCw size={26}/></div>
    <h2>Connect a provider to import subscriptions</h2>
    <p>Provider Subscriptions are billing records imported from an external account you connect — starting with Google. This is different from Recurring Payments, which Finance Planner detects automatically from your own transaction history.</p>
    <div className="subscriptions-scope-callout">
      <p>What this does</p>
      <ul className="subscriptions-does">
        <li><Check size={16} aria-hidden="true"/> Confirms your identity with Google, then checks for subscription and billing records associated with that account.</li>
        <li><Check size={16} aria-hidden="true"/> Imports the amount, billing interval, and status Google's data reports for each one.</li>
      </ul>
      <p>What this doesn't do</p>
      <ul className="subscriptions-does-not">
        <li><X size={16} aria-hidden="true"/> It doesn't read your email, files, or Google Drive.</li>
        <li><X size={16} aria-hidden="true"/> It doesn't let Finance Planner cancel or change a subscription — this is read-only.</li>
        <li><X size={16} aria-hidden="true"/> It isn't a bank connection — it doesn't move money or see your bank balance.</li>
      </ul>
    </div>
    <button type="button" className="primary" onClick={onContinue}><ExternalLink size={17}/> Continue to Google</button>
  </div>
}

function PreflightPanel({ onCancel, onContinue, busy, error }: { onCancel: () => void; onContinue: () => void; busy: boolean; error: string }) {
  return <div className="subscriptions-preflight">
    <div className="subscriptions-intro-icon" aria-hidden="true"><ExternalLink size={26}/></div>
    <h2>You're about to leave Finance Planner</h2>
    <div className="subscriptions-preflight-lines">
      <p>You'll go to accounts.google.com to confirm it's really you.</p>
      <p>Google will ask you to confirm your identity (name and email) — Finance Planner doesn't see or store your Google password.</p>
      <p>After you return, Finance Planner checks for subscription and billing information linked to that account.</p>
    </div>
    {error && <p className="status-message error-message" role="alert">{error}</p>}
    <div className="subscriptions-preflight-actions">
      <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button type="button" className="primary" disabled={busy} onClick={onContinue}>{busy ? 'Starting…' : 'Continue to Google'}</button>
    </div>
  </div>
}

function EmptyConnected({ lastSyncAt, onSync, onManage }: { lastSyncAt: string | undefined; onSync: () => void; onManage: () => void }) {
  return <>
    <StatusHeader lastSyncAt={lastSyncAt} syncing={false} onSync={onSync}/>
    <div className="panel subscriptions-empty">
      <div className="subscriptions-empty-icon" aria-hidden="true"><Calendar size={26}/></div>
      <h2>No subscriptions found</h2>
      <p>Your connected Google account didn't return any eligible subscriptions to import. This isn't an error — it just means there was nothing to bring in this time.</p>
      <button type="button" className="secondary" onClick={onSync}>Sync again</button>
    </div>
    <button type="button" className="subscriptions-manage-link" onClick={onManage}>Manage connection →</button>
  </>
}

function UnavailablePanel({ onRetry }: { onRetry: () => void }) {
  return <div className="panel subscriptions-alert" role="alert">
    <h2 className="subscriptions-alert-heading"><AlertTriangle size={20} aria-hidden="true"/> Subscriptions aren't available right now.</h2>
    <p>Finance Planner's Google Subscriptions connection isn't currently available. This isn't something wrong with your account — try again later.</p>
    <button type="button" className="secondary" onClick={onRetry}><RefreshCw size={16}/> Try again</button>
  </div>
}

function SyncErrorPanel({ onRetry, hasPreservedList }: { onRetry: () => void; hasPreservedList: boolean }) {
  return <div className="panel subscriptions-alert" role="alert">
    <h2 className="subscriptions-alert-heading"><AlertTriangle size={20} aria-hidden="true"/> Couldn't sync your subscriptions.</h2>
    <p>{hasPreservedList ? 'The last sync attempt failed. What was imported before is still shown below.' : "The last sync attempt failed. Check your connection and try again."}</p>
    <button type="button" className="secondary" onClick={onRetry}><RefreshCw size={16}/> Try again</button>
  </div>
}

// SUB-01..07: Provider Subscriptions. Always re-syncs on mount to reflect
// the real, current connection state rather than trusting stale local data
// -- the connection can change server-side (token expiry, revocation)
// between visits. Imported records are reconciled into the shared
// AppState.subscriptions field via reconcileGoogleSubscriptions so they
// persist and sync like the rest of the user's data, and never overlap
// with transaction-derived Recurring Payments (see subscriptionMatchesTransaction).
export function SubscriptionsPage({ state, onApply, acceptanceMode }: SubscriptionsPageProps) {
  const [view, setView] = useState<PageView>(acceptanceMode === 'manage' ? 'manage' : acceptanceMode === 'preflight' ? 'preflight' : 'main')
  const [connection, setConnection] = useState<GoogleSubscriptionConnection | null>(() => fixtureConnection(acceptanceMode))
  const [initialLoading, setInitialLoading] = useState(!acceptanceMode)
  const [syncing, setSyncing] = useState(acceptanceMode === 'syncing')
  const [syncError, setSyncError] = useState(acceptanceMode === 'subscription-sync-error' ? "Couldn't reach Finance Planner's servers." : '')
  const [preflightBusy, setPreflightBusy] = useState(false)
  const [preflightError, setPreflightError] = useState('')

  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state }, [state])

  const runSync = async () => {
    setSyncing(true)
    setSyncError('')
    try {
      const result = await syncGoogleSubscriptions()
      setConnection(result)
      if (result.connected) {
        const normalized = normalizeGoogleSubscriptions(result.subscriptions, result.lastSyncAt)
        onApply(reconcileGoogleSubscriptions(stateRef.current, normalized))
      }
    } catch (reason) {
      setSyncError(reason instanceof Error ? reason.message : "Couldn't sync your subscriptions.")
    } finally {
      setSyncing(false)
      setInitialLoading(false)
    }
  }

  useEffect(() => {
    if (acceptanceMode) return
    void runSync()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; runSync reads live state via stateRef
  }, [])

  useEffect(() => {
    if (!acceptanceMode) return
    applyFixtureState(acceptanceMode, stateRef.current, onApply)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per fixture mode; reads live state via stateRef
  }, [acceptanceMode])

  const googleSubscriptions = (state.subscriptions ?? []).filter((subscription) => subscription.source === 'google')

  if (view === 'manage') {
    return <SubscriptionsManage
      state={state}
      onApply={onApply}
      connection={connection}
      googleSubscriptions={googleSubscriptions}
      onBack={() => setView('main')}
      onDisconnected={() => { setConnection({ connected: false, subscriptions: [], unavailableReason: 'not_connected' }); setView('main') }}
    />
  }

  if (view === 'preflight') {
    return <div className="subscriptions-page" lang="en" data-subscriptions-ready="true">
      <PreflightPanel
        busy={preflightBusy}
        error={preflightError}
        onCancel={() => setView('main')}
        onContinue={() => {
          setPreflightBusy(true)
          setPreflightError('')
          startGoogleSubscriptionConnection().catch((reason: unknown) => {
            setPreflightBusy(false)
            setPreflightError(reason instanceof Error ? reason.message : "Couldn't start the connection. Check your connection and try again.")
          })
        }}
      />
    </div>
  }

  if (initialLoading) {
    return <div className="subscriptions-page" lang="en" data-subscriptions-ready="true">
      <div className="subscriptions-loading" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={24} aria-hidden="true"/>
        <span>Checking your connection…</span>
      </div>
    </div>
  }

  const capabilityUnavailable = Boolean(connection && !connection.connected && connection.unavailableReason && connection.unavailableReason !== 'not_connected')
  const neverConnected = Boolean(connection && !connection.connected && (!connection.unavailableReason || connection.unavailableReason === 'not_connected'))

  let body: ReactNode
  if (syncError && !connection) {
    body = <SyncErrorPanel hasPreservedList={false} onRetry={() => void runSync()}/>
  } else if (capabilityUnavailable) {
    body = <UnavailablePanel onRetry={() => void runSync()}/>
  } else if (neverConnected) {
    body = <IntroPanel onContinue={() => setView('preflight')}/>
  } else if (connection?.connected && syncError) {
    body = <>
      <SyncErrorPanel hasPreservedList onRetry={() => void runSync()}/>
      <p className="subscriptions-list-footer">Last synced: {formatRelativeTime(connection.lastSyncAt)}</p>
      <ul className="subscriptions-list">
        {googleSubscriptions.map((subscription) => <SubscriptionRow key={subscription.id} subscription={subscription}/>)}
      </ul>
      <button type="button" className="subscriptions-manage-link" onClick={() => setView('manage')}>Manage connection →</button>
    </>
  } else if (connection?.connected && googleSubscriptions.length === 0) {
    body = <EmptyConnected lastSyncAt={connection.lastSyncAt} onSync={() => void runSync()} onManage={() => setView('manage')}/>
  } else if (connection?.connected) {
    body = <SubscriptionsList subscriptions={googleSubscriptions} lastSyncAt={connection.lastSyncAt} syncing={syncing} onSync={() => void runSync()} onManage={() => setView('manage')}/>
  } else {
    body = <IntroPanel onContinue={() => setView('preflight')}/>
  }

  return <div className="subscriptions-page" lang="en" data-subscriptions-ready="true">{body}</div>
}

function fixtureConnection(mode: SubscriptionsAcceptanceMode | undefined): GoogleSubscriptionConnection | null {
  if (!mode) return null
  const lastSyncAt = '2026-08-07T09:55:00.000Z'
  if (mode === 'connected' || mode === 'syncing') return { connected: true, lastSyncAt, subscriptions: [] }
  if (mode === 'no-subscriptions') return { connected: true, lastSyncAt, subscriptions: [] }
  if (mode === 'subscription-sync-error') return { connected: true, lastSyncAt, subscriptions: [] }
  if (mode === 'manage') return { connected: true, lastSyncAt, subscriptions: [] }
  if (mode === 'unavailable') return { connected: false, subscriptions: [], unavailableReason: 'disabled' }
  return { connected: false, subscriptions: [], unavailableReason: 'not_connected' }
}

function applyFixtureState(mode: SubscriptionsAcceptanceMode, state: AppState, onApply: (state: AppState) => void): void {
  const wantsSubscriptions = mode === 'connected' || mode === 'syncing' || mode === 'subscription-sync-error' || mode === 'manage'
  const hasFixtureData = (state.subscriptions ?? []).some((subscription) => subscription.id === FIXTURE_SUBSCRIPTIONS[0]!.id)
  if (wantsSubscriptions && !hasFixtureData) {
    onApply({ ...state, subscriptions: [...(state.subscriptions ?? []).filter((subscription) => subscription.source !== 'google'), ...FIXTURE_SUBSCRIPTIONS] })
  } else if (!wantsSubscriptions && (state.subscriptions ?? []).some((subscription) => subscription.source === 'google')) {
    onApply({ ...state, subscriptions: (state.subscriptions ?? []).filter((subscription) => subscription.source !== 'google') })
  }
}
