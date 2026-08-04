import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, BrainCircuit, Building2, CheckCircle2, CreditCard, FileUp, Landmark, MailCheck, RefreshCw, RotateCcw, Search, ShieldCheck, Unplug, WalletCards, X } from 'lucide-react'
import { applySyncPreview, buildSyncPreview, consentDaysRemaining, disconnectConnector, selectSyncPreviewAccounts, startConnector, synchronizeConnections, type ConnectorAccountType, type ConnectorConnection, type ConnectorProvider, type SyncPreview } from './connectors'
import {
  disconnectGoogleSubscriptions,
  getGoogleSubscriptionCapability,
  normalizeGoogleSubscriptions,
  reconcileGoogleSubscriptions,
  startGoogleSubscriptionConnection,
  syncGoogleSubscriptions,
  type GoogleSubscriptionCapability,
  type GoogleSubscriptionConnection,
} from './googleSubscriptions'
import { commonInstitutions, institutionById, searchInstitutions, type InstitutionKind } from './institutions'
import { normalizeManualCreditCard } from './manualCreditCard'
import { applyStatementImport, buildStatementPreview, parseStatement, type StatementPreview } from './statementImport'
import type { Account, AppState } from './types'

interface ConnectionsPanelProps { state: AppState; onApply: (state: AppState) => void }
type InstitutionFilter = 'popular' | InstitutionKind

const categoryOptions: Array<{ id: InstitutionFilter; label: string }> = [
  { id: 'popular', label: 'Häufig' },
  { id: 'bank', label: 'Banken' },
  { id: 'wallet', label: 'PayPal' },
  { id: 'broker', label: 'Depots' },
  { id: 'card', label: 'Karten' },
  { id: 'manual', label: 'Manuell' },
]

const accountTypeOptions: Array<{ id: ConnectorAccountType; label: string }> = [
  { id: 'checking', label: 'Girokonto' },
  { id: 'savings', label: 'Sparkonto' },
  { id: 'credit-card', label: 'Kreditkarte' },
  { id: 'investment', label: 'Depot' },
]

const intervalLabels: Record<string, string> = {
  weekly: 'wöchentlich',
  monthly: 'monatlich',
  quarterly: 'vierteljährlich',
  yearly: 'jährlich',
}

function cents(value: string, field: string, optional = false): number {
  const normalized = value.trim().replace(',', '.')
  if (!normalized && optional) return 0
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`${field} muss ein gültiger positiver Euro-Betrag mit höchstens zwei Nachkommastellen sein.`)
  const parsed = Number(normalized)
  const result = Math.round(parsed * 100)
  if (!Number.isSafeInteger(result) || result < 0 || result > 100_000_000_000) throw new Error(`${field} liegt außerhalb des unterstützten Bereichs.`)
  return result
}

function googleCapabilityMessage(capability: GoogleSubscriptionCapability | null): string {
  if (!capability) return 'Google-Funktion wird geprüft …'
  if (capability.ready) return capability.source === 'gmail'
    ? 'Bereit für Gmail-Belegimport mit Leseberechtigung.'
    : 'Bereit für den konfigurierten normalisierten Datenendpunkt.'
  if (capability.reason === 'disabled') return 'Der Google-Abonnementimport ist serverseitig deaktiviert.'
  if (capability.reason === 'missing_oauth_configuration') return 'Google OAuth ist für diese Funktion noch nicht konfiguriert.'
  if (capability.reason === 'missing_data_source') return 'Der benutzerdefinierte Google-Datenendpunkt fehlt.'
  return 'Die Google-Abonnementfunktion ist derzeit nicht verfügbar.'
}

export function ConnectionsPanel({ state, onApply }: ConnectionsPanelProps) {
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [connections, setConnections] = useState<ConnectorConnection[]>([])
  const [previews, setPreviews] = useState<SyncPreview[]>([])
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [statementPreview, setStatementPreview] = useState<StatementPreview | null>(null)
  const [rollbackState, setRollbackState] = useState<AppState | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupStep, setSetupStep] = useState<1 | 2 | 3>(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [category, setCategory] = useState<InstitutionFilter>('popular')
  const [selectedInstitutionId, setSelectedInstitutionId] = useState<string | null>(null)
  const [accountType, setAccountType] = useState<ConnectorAccountType>('checking')
  const [manualName, setManualName] = useState('')
  const [manualBalance, setManualBalance] = useState('')
  const [manualLimit, setManualLimit] = useState('')
  const [manualPending, setManualPending] = useState('')
  const [googleCapability, setGoogleCapability] = useState<GoogleSubscriptionCapability | null>(null)
  const [googleConnection, setGoogleConnection] = useState<GoogleSubscriptionConnection | null>(null)

  const selectedInstitution = selectedInstitutionId ? institutionById(selectedInstitutionId) : undefined
  const filteredInstitutions = useMemo(() => searchInstitutions(searchTerm, commonInstitutions, category === 'popular' ? { popularOnly: true } : { kinds: [category] }), [searchTerm, category])
  const selectedPreviews = useMemo(() => previews.map((preview) => selectSyncPreviewAccounts(preview, selectedAccountIds)), [previews, selectedAccountIds])
  const summary = useMemo(() => selectedPreviews.reduce((result, preview) => ({
    accounts: result.accounts + preview.accountsToCreate.length,
    transactions: result.transactions + preview.transactionsToImport.length,
    duplicates: result.duplicates + preview.duplicateCount,
    pending: result.pending + preview.pendingCount,
    smartCategorized: result.smartCategorized + preview.quality.smartCategorized,
    needsReview: result.needsReview + preview.quality.needsReview,
    qualityTotal: result.qualityTotal + preview.quality.score,
  }), { accounts: 0, transactions: 0, duplicates: 0, pending: 0, smartCategorized: 0, needsReview: 0, qualityTotal: 0 }), [selectedPreviews])
  const averageQuality = selectedPreviews.length ? Math.round(summary.qualityTotal / selectedPreviews.length) : 0
  const qualityWarnings = [...new Set(selectedPreviews.flatMap((preview) => preview.quality.warnings))]
  const discoveredAccounts = previews.flatMap((preview) => preview.accountsToCreate)
  const googleSubscriptions = (state.subscriptions || []).filter((subscription) => subscription.source === 'google')

  const synchronizeGoogle = async () => {
    setGoogleBusy(true)
    setError('')
    try {
      const result = await syncGoogleSubscriptions()
      setGoogleConnection(result)
      setGoogleCapability((current) => current ? { ...current, connected: result.connected, lastSyncAt: result.lastSyncAt } : current)
      if (!result.connected) {
        setMessage('Google ist noch nicht für den Abonnementimport verbunden.')
        return
      }
      const imported = normalizeGoogleSubscriptions(result.subscriptions, result.lastSyncAt)
      const next = reconcileGoogleSubscriptions(state, imported)
      onApply(next)
      const omitted = imported.length - (next.subscriptions || []).filter((subscription) => subscription.source === 'google').length
      setMessage(`${imported.length} Google-Belegdatensätze geprüft und ${(next.subscriptions || []).filter((subscription) => subscription.source === 'google').length} Abonnements übernommen.${omitted > 0 ? ` ${omitted} Dublette(n) zu Bankbuchungen wurden nicht doppelt angelegt.` : ''}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google-Abonnements konnten nicht synchronisiert werden.')
    } finally {
      setGoogleBusy(false)
    }
  }

  useEffect(() => {
    void getGoogleSubscriptionCapability()
      .then((capability) => setGoogleCapability(capability))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Google-Funktionsstatus konnte nicht geladen werden.'))
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const provider = params.get('provider')
    const callbackError = params.get('error_description') || params.get('error')
    const callbackCompleted = params.has('code') || params.has('state') || params.get('connected') === '1'
    if (!provider && !callbackError && !callbackCompleted) return

    const cleanUrl = new URL(window.location.href)
    for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider', 'institution', 'connected']) cleanUrl.searchParams.delete(key)
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)

    if (callbackError) {
      setError(`Die Verbindung wurde nicht abgeschlossen: ${callbackError}`)
      return
    }
    if (provider === 'google-subscriptions') {
      setMessage('Google hat die Leseberechtigung bestätigt. Passende Abo-Belege werden jetzt geprüft.')
      void synchronizeGoogle()
      return
    }
    setMessage('Anbieter bestätigt. Die Verbindung wird geprüft und die verfügbaren Konten werden geladen.')
    void synchronize()
  }, [])

  const connect = async (provider: ConnectorProvider) => {
    setBusy(true)
    setError('')
    setMessage(provider === 'paypal' ? 'Du wirst jetzt zu PayPal weitergeleitet und danach sicher zu Finance Planner zurückgebracht.' : 'Du wirst jetzt sicher zur Bank oder zum offiziellen PSD2-Anbieter weitergeleitet. Finance Planner erhält niemals dein Online-Banking-Passwort.')
    try {
      await startConnector(provider, { institutionId: selectedInstitution?.id, institutionName: selectedInstitution?.name, accountType })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verbindung konnte nicht gestartet werden.')
      setBusy(false)
    }
  }

  const synchronize = async () => {
    setBusy(true)
    setError('')
    setPreviews([])
    setSelectedAccountIds(new Set())
    try {
      const payloads = await synchronizeConnections()
      setConnections(payloads.map((payload) => payload.connection))
      const successful = payloads.filter((payload) => payload.connection.status !== 'error')
      const next = successful.map((payload) => buildSyncPreview(state, payload))
      setPreviews(next)
      setSelectedAccountIds(new Set(next.flatMap((preview) => preview.accountsToCreate.map((account) => account.id))))
      const failed = payloads.filter((payload) => payload.connection.status === 'error')
      setMessage(next.length ? `Aktualisierung abgeschlossen. ${failed.length ? `${failed.length} Verbindung(en) benötigen Aufmerksamkeit. ` : ''}Wähle jetzt die Konten aus, die du importieren möchtest.` : failed.length ? 'Keine Verbindung konnte erfolgreich aktualisiert werden.' : 'Noch kein Konto verbunden.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Synchronisierung fehlgeschlagen.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (provider: ConnectorProvider) => {
    if (!window.confirm('Diese Verbindung wirklich trennen? Bereits importierte Buchungen bleiben erhalten.')) return
    setBusy(true)
    setError('')
    try {
      await disconnectConnector(provider)
      setConnections((current) => current.filter((connection) => connection.provider !== provider))
      setMessage('Verbindung wurde sicher getrennt. Bereits importierte Buchungen bleiben erhalten.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verbindung konnte nicht getrennt werden.')
    } finally {
      setBusy(false)
    }
  }

  const connectGoogle = async () => {
    if (!googleCapability?.ready) return
    setGoogleBusy(true)
    setError('')
    try {
      await startGoogleSubscriptionConnection(window.location.href)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google-Verbindung konnte nicht gestartet werden.')
      setGoogleBusy(false)
    }
  }

  const disconnectGoogle = async () => {
    if (!window.confirm('Google-Abonnementzugriff wirklich trennen und die Google-Berechtigung widerrufen?')) return
    const deleteImportedData = window.confirm('Sollen auch bereits importierte Google-Abonnements entfernt werden? Manuelle Verträge bleiben erhalten.')
    setGoogleBusy(true)
    setError('')
    try {
      const result = await disconnectGoogleSubscriptions(deleteImportedData)
      setGoogleConnection(null)
      setGoogleCapability((current) => current ? { ...current, connected: false, lastSyncAt: undefined } : current)
      if (deleteImportedData) onApply({ ...state, subscriptions: (state.subscriptions || []).filter((subscription) => subscription.source !== 'google') })
      setMessage(`Google wurde getrennt.${result.revoked ? ' Die Google-Berechtigung wurde widerrufen.' : ''}${deleteImportedData ? ` ${result.deletedSubscriptionCount} importierte Datensätze wurden entfernt.` : ' Importierte Abonnements bleiben erhalten.'}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google-Verbindung konnte nicht getrennt werden.')
    } finally {
      setGoogleBusy(false)
    }
  }

  const openSetup = () => {
    setSetupStep(1)
    setSearchTerm('')
    setCategory('popular')
    setSelectedInstitutionId(null)
    setAccountType('checking')
    setManualName('')
    setManualBalance('')
    setManualLimit('')
    setManualPending('')
    setSetupOpen(true)
  }

  const chooseInstitution = (id: string) => {
    const institution = institutionById(id)
    if (!institution) return
    setSelectedInstitutionId(id)
    if (institution.kind === 'card') setAccountType('credit-card')
    else if (institution.kind === 'broker') setAccountType('investment')
    else setAccountType('checking')
    setSetupStep(institution.accountTypeRequired ? 2 : 3)
  }

  const addManualAccount = async () => {
    if (!selectedInstitution || busy) return
    setBusy(true)
    setError('')
    try {
      const name = manualName.trim() || selectedInstitution.name
      const balance = cents(manualBalance, accountType === 'credit-card' ? 'Der offene Betrag' : 'Der Kontostand')
      const id = `manual:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now()}`
      let account: Account
      if (accountType === 'credit-card') {
        const limit = cents(manualLimit, 'Das Kreditlimit', true)
        const pending = cents(manualPending, 'Der vorgemerkte Betrag', true)
        const normalized = await normalizeManualCreditCard({ providerBalanceCents: balance, creditLimitCents: limit, pendingAmountCents: pending })
        account = {
          id,
          name,
          type: 'credit-card',
          balanceCents: normalized.ledgerBalanceCents,
          currency: 'EUR',
          creditCard: {
            amountOwedCents: normalized.amountOwedCents,
            creditLimitCents: limit || undefined,
            availableCreditCents: normalized.availableCreditCents,
            pendingAmountCents: normalized.pendingAmountCents,
          },
        }
      } else {
        account = { id, name, type: accountType, balanceCents: balance, currency: 'EUR' }
      }
      onApply({ ...state, accounts: [...state.accounts, account] })
      setSetupOpen(false)
      setMessage(`${name} wurde als manuelles Konto angelegt.${accountType === 'credit-card' ? ' Saldo und Kreditrahmen wurden vom COBOL-Banking-Kern berechnet.' : ''}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Das manuelle Konto konnte nicht angelegt werden.')
    } finally {
      setBusy(false)
    }
  }

  const toggleAccount = (accountId: string) => setSelectedAccountIds((current) => {
    const next = new Set(current)
    if (next.has(accountId)) next.delete(accountId); else next.add(accountId)
    return next
  })

  const importPreview = () => {
    if (!summary.accounts) return
    setRollbackState(state)
    onApply(selectedPreviews.reduce((current, preview) => applySyncPreview(current, preview), state))
    setPreviews([])
    setSelectedAccountIds(new Set())
    setMessage(`${summary.transactions} Transaktionen und ${summary.accounts} ausgewählte Konten wurden übernommen.`)
  }
  const readStatement = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setError(''); setMessage(''); setStatementPreview(null); try { if (file.size > 5 * 1024 * 1024) throw new Error('Die Datei ist größer als 5 MB.'); const parsed = parseStatement(await file.text(), file.name); setStatementPreview(buildStatementPreview(state, parsed)); setMessage(`${parsed.rows.length} Buchungen aus ${file.name} gelesen. Prüfe die Vorschau.`) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kontoauszug konnte nicht gelesen werden.') } }
  const importStatement = () => { if (!statementPreview) return; setRollbackState(state); onApply(applyStatementImport(state, statementPreview)); setMessage(`${statementPreview.transactions.length} Buchungen importiert; ${statementPreview.duplicates} Duplikate übersprungen.`); setStatementPreview(null) }
  const rollback = () => { if (!rollbackState) return; onApply(rollbackState); setRollbackState(null); setMessage('Der letzte Import wurde vollständig zurückgesetzt.') }

  return <div className="connections-page">
    <section className="panel bank-setup-hero">
      <div><p className="eyebrow">Automatisch aktuell</p><h2>Deine Finanzen in wenigen Schritten verbinden</h2><p>Bank oder Anbieter auswählen, dort anmelden und anschließend nur die gewünschten Konten importieren.</p><div className="bank-trust-row"><span><ShieldCheck size={16}/> PSD2-geschützt</span><span><CheckCircle2 size={16}/> Jederzeit widerrufbar</span><span><CheckCircle2 size={16}/> Kein Passwort bei uns</span></div></div>
      <button className="primary bank-connect-primary" disabled={busy} onClick={openSetup}><Building2 size={18}/> Konto verbinden</button>
    </section>

    <section className="panel connection-overview">
      <div className="panel-header"><div><p className="eyebrow">Meine Verbindungen</p><h2>{connections.length ? `${connections.length} aktive Verbindung${connections.length === 1 ? '' : 'en'}` : 'Noch kein Konto verbunden'}</h2></div>{connections.length > 0 && <button className="secondary" disabled={busy} onClick={synchronize}><RefreshCw size={17}/>{busy ? 'Aktualisiere …' : 'Alle aktualisieren'}</button>}</div>
      {connections.length === 0 ? <div className="connection-empty-state"><div className="goal-hero-icon"><Building2 size={24}/></div><strong>Starte mit deinem Hauptkonto</strong><span>Die Einrichtung dauert normalerweise weniger als zwei Minuten.</span><button className="secondary" onClick={openSetup}>Erstes Konto verbinden <ArrowRight size={16}/></button></div> : <div className="connection-health-list">{connections.map((connection) => { const days = consentDaysRemaining(connection); const needsAttention = connection.status === 'error' || (days !== null && days <= 7); return <div className="account-row connection-row" key={connection.id}><div className="account-icon">{needsAttention ? <AlertTriangle size={19}/> : <CheckCircle2 size={19}/>}</div><div><strong>{connection.displayName}</strong><span>{connection.status === 'error' ? connection.error || 'Verbindung benötigt Aufmerksamkeit' : connection.lastSyncAt ? `Zuletzt aktualisiert: ${new Date(connection.lastSyncAt).toLocaleString('de-DE')}` : 'Sicher verbunden'}{days !== null ? ` · Zustimmung ${days < 0 ? 'abgelaufen' : `noch ${days} Tage gültig`}` : ''}</span></div><div className="connection-row-actions">{needsAttention && <button className="secondary" onClick={() => connect(connection.provider)}>Erneut verbinden</button>}<button className="secondary" disabled={busy} onClick={() => disconnect(connection.provider)}><Unplug size={16}/> Trennen</button></div></div> })}</div>}
    </section>

    <section className="panel connection-overview" aria-labelledby="google-subscriptions-title">
      <div className="panel-header"><div><p className="eyebrow">Verträge aus Google-Belegen</p><h2 id="google-subscriptions-title">Google-Abonnements</h2></div><MailCheck size={23}/></div>
      <p className="muted">{googleCapabilityMessage(googleCapability)}</p>
      {googleCapability?.limitations?.length ? <div className="privacy-box"><ShieldCheck size={17}/><span>{googleCapability.limitations.join(' ')}</span></div> : null}
      {googleSubscriptions.length > 0 && <div className="connection-health-list">{googleSubscriptions.map((subscription) => <div className="account-row connection-row" key={subscription.id}><div className="account-icon"><MailCheck size={18}/></div><div><strong>{subscription.product}</strong><span>{subscription.provider} · {(subscription.amountCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })} · {intervalLabels[subscription.billingInterval] || subscription.billingInterval} · {subscription.status}</span></div></div>)}</div>}
      <div className="modal-actions bank-modal-actions">
        {googleCapability?.connected || googleConnection?.connected
          ? <><button className="secondary" disabled={googleBusy} onClick={() => void synchronizeGoogle()}><RefreshCw size={16}/>{googleBusy ? 'Prüfe Belege …' : 'Google-Abos aktualisieren'}</button><button className="secondary" disabled={googleBusy} onClick={() => void disconnectGoogle()}><Unplug size={16}/> Google trennen</button></>
          : <button className="primary" disabled={googleBusy || !googleCapability?.ready} onClick={() => void connectGoogle()}><MailCheck size={17}/>{googleBusy ? 'Weiterleitung wird vorbereitet …' : 'Google-Belege verbinden'}</button>}
      </div>
    </section>

    <section className="panel statement-import"><div><p className="eyebrow">Ohne Bankverbindung</p><h2>Kontoauszug importieren</h2><p className="muted">CSV sowie CAMT.052, CAMT.053 und CAMT.054 werden unterstützt. Vor dem Import siehst du immer eine Vorschau.</p></div><label className="secondary file-button"><FileUp size={17}/>Datei auswählen<input type="file" accept=".csv,.xml,.camt,text/csv,application/xml,text/xml" onChange={readStatement}/></label></section>

    {statementPreview && <section className="panel sync-preview"><div className="panel-header"><div><p className="eyebrow">Auszugsvorschau</p><h2>{statementPreview.account.name}</h2></div><CheckCircle2 size={24}/></div><div className="stats-grid compact"><article className="stat-card"><span>Buchungen</span><strong>{statementPreview.transactions.length}</strong></article><article className="stat-card"><span>Duplikate</span><strong>{statementPreview.duplicates}</strong></article><article className="stat-card"><span>Fehlerhafte Zeilen</span><strong>{statementPreview.rejected}</strong></article><article className="stat-card"><span>Format</span><strong>{statementPreview.format.toUpperCase()}</strong></article></div><button className="primary" disabled={!statementPreview.transactions.length} onClick={importStatement}>Geprüfte Buchungen importieren</button></section>}
    {previews.length > 0 && <section className="panel sync-preview"><div className="panel-header"><div><p className="eyebrow">Konten auswählen</p><h2>{selectedAccountIds.size} von {discoveredAccounts.length} Konten ausgewählt</h2></div><BrainCircuit size={24}/></div><div className="connection-health-list">{discoveredAccounts.map((account) => <label className="account-row connection-row" key={account.id}><input type="checkbox" checked={selectedAccountIds.has(account.id)} onChange={() => toggleAccount(account.id)}/><div className="account-icon">{account.type === 'credit-card' ? <CreditCard size={18}/> : <Landmark size={18}/>}</div><div><strong>{account.name}</strong><span>{account.type === 'credit-card' && account.creditCard ? `Offener Betrag ${(account.creditCard.amountOwedCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}${account.creditCard.availableCreditCents !== undefined ? ` · Verfügbar ${(account.creditCard.availableCreditCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''}` : `${(account.balanceCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`}</span></div></label>)}</div><div className="stats-grid compact"><article className="stat-card"><span>Neue Konten</span><strong>{summary.accounts}</strong></article><article className="stat-card"><span>Neue Buchungen</span><strong>{summary.transactions}</strong></article><article className="stat-card"><span>Datenqualität</span><strong>{averageQuality}%</strong></article><article className="stat-card"><span>Vorgemerkt</span><strong>{summary.pending}</strong></article></div><p className="muted">Vorgemerkte Buchungen werden nicht importiert. Duplikate werden automatisch erkannt.</p>{qualityWarnings.length > 0 && <div className="privacy-box"><ShieldCheck size={17}/><span>{qualityWarnings.join(' ')}</span></div>}<button className="primary" disabled={!summary.accounts} onClick={importPreview}>Ausgewählte Konten übernehmen</button></section>}
    {rollbackState && <button className="secondary rollback-button" onClick={rollback}><RotateCcw size={17}/>Letzten Import zurücksetzen</button>}
    {message && <p className="status-message success-message" role="status">{message}</p>}{error && <p className="status-message error-message" role="alert">{error}</p>}

    {setupOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSetupOpen(false) }}>
      <section className="modal bank-setup-modal" role="dialog" aria-modal="true" aria-labelledby="bank-setup-title">
        <div className="bank-setup-modal-header"><div><p className="eyebrow">Schritt {setupStep} von 3</p><h2 id="bank-setup-title">{setupStep === 1 ? 'Bank oder Anbieter auswählen' : setupStep === 2 ? 'Kontotyp auswählen' : selectedInstitution?.provider === 'manual' ? 'Manuelles Konto anlegen' : 'Sicher bestätigen'}</h2></div><button className="icon-button" aria-label="Einrichtung schließen" disabled={busy} onClick={() => setSetupOpen(false)}><X size={20}/></button></div>
        <div className="setup-progress" aria-hidden="true"><span className="active"/><span className={setupStep >= 2 ? 'active' : ''}/><span className={setupStep === 3 ? 'active' : ''}/></div>

        {setupStep === 1 && <><div className="bank-category-tabs" role="tablist" aria-label="Anbieterkategorie">{categoryOptions.map((option) => <button type="button" role="tab" aria-selected={category === option.id} className={category === option.id ? 'secondary active' : 'secondary'} key={option.id} onClick={() => setCategory(option.id)}>{option.label}</button>)}</div><label className="bank-search"><Search size={18}/><input autoFocus value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Name, BIC oder BLZ"/></label><div className="bank-picker-list">{filteredInstitutions.map((institution) => { const Icon = institution.kind === 'wallet' ? CreditCard : institution.kind === 'broker' ? WalletCards : Building2; const connected = institution.provider !== 'manual' && connections.some((connection) => connection.provider === institution.provider && connection.status === 'connected'); return <button className="bank-picker-item" key={institution.id} disabled={connected} onClick={() => chooseInstitution(institution.id)}><span className="bank-picker-icon"><Icon size={22}/></span><span><strong>{institution.name}</strong><small>{connected ? 'Bereits verbunden' : [institution.bic, institution.blz ? `BLZ ${institution.blz}` : null, institution.provider === 'manual' ? 'Ohne externe Verbindung' : 'Sichere Weiterleitung'].filter(Boolean).join(' · ')}</small></span><ArrowRight size={18}/></button> })}</div>{filteredInstitutions.length === 0 && <div className="connection-empty-state compact"><strong>Keine passende Institution gefunden</strong><span>Prüfe Name, BIC oder BLZ oder nutze ein manuelles Konto.</span></div>}</>}

        {setupStep === 2 && selectedInstitution && <><div className="provider-confirmation"><span className="bank-picker-icon"><Building2 size={26}/></span><div><strong>{selectedInstitution.name}</strong><span>Wähle den Kontotyp, den du verbinden oder manuell anlegen möchtest.</span></div></div><div className="bank-picker-list">{accountTypeOptions.map((option) => <button className="bank-picker-item" key={option.id} onClick={() => { setAccountType(option.id); setSetupStep(3) }}><span className="bank-picker-icon">{option.id === 'credit-card' ? <CreditCard size={21}/> : <WalletCards size={21}/>}</span><span><strong>{option.label}</strong><small>Nur dieser Kontotyp wird für die Einrichtung vorausgewählt.</small></span><ArrowRight size={18}/></button>)}</div><div className="modal-actions"><button className="secondary" onClick={() => setSetupStep(1)}><ArrowLeft size={16}/> Zurück</button></div></>}

        {setupStep === 3 && selectedInstitution && selectedInstitution.provider === 'manual' && <><div className="provider-confirmation"><span className="bank-picker-icon"><CreditCard size={26}/></span><div><strong>{selectedInstitution.name}</strong><span>Die Daten bleiben im Finance-Planner-Konto und werden nicht extern synchronisiert.</span></div></div><label className="field"><span>Name</span><input value={manualName} onChange={(event) => setManualName(event.target.value)} placeholder={accountType === 'credit-card' ? 'Meine Visa' : 'Mein Konto'}/></label><label className="field"><span>{accountType === 'credit-card' ? 'Offener Betrag' : 'Kontostand'} in Euro</span><input inputMode="decimal" value={manualBalance} onChange={(event) => setManualBalance(event.target.value)} placeholder="0,00"/></label>{accountType === 'credit-card' && <><label className="field"><span>Kreditlimit in Euro (optional)</span><input inputMode="decimal" value={manualLimit} onChange={(event) => setManualLimit(event.target.value)} placeholder="0,00"/></label><label className="field"><span>Vorgemerkter Betrag in Euro (optional)</span><input inputMode="decimal" value={manualPending} onChange={(event) => setManualPending(event.target.value)} placeholder="0,00"/></label><div className="privacy-box"><ShieldCheck size={17}/><span>Offener Betrag, Verbindlichkeit und verfügbarer Kreditrahmen werden authentifiziert auf dem Server durch den GnuCOBOL-Banking-Kern berechnet. Bei einem Fehler wird keine lokale Ersatzberechnung gespeichert.</span></div></>}<div className="modal-actions bank-modal-actions"><button className="secondary" disabled={busy} onClick={() => setSetupStep(selectedInstitution.accountTypeRequired ? 2 : 1)}><ArrowLeft size={16}/> Zurück</button><button className="primary" disabled={busy} onClick={() => void addManualAccount()}>{busy ? 'Wird geprüft …' : 'Konto anlegen'} <CheckCircle2 size={16}/></button></div></>}

        {setupStep === 3 && selectedInstitution && selectedInstitution.provider !== 'manual' && <><div className="provider-confirmation"><span className="bank-picker-icon">{selectedInstitution.provider === 'paypal' ? <CreditCard size={26}/> : <Building2 size={26}/>}</span><div><strong>{selectedInstitution.name}</strong><span>{selectedInstitution.provider === 'paypal' ? 'Die Anmeldung findet bei PayPal statt. Danach kehrst du automatisch zurück.' : 'Die Anmeldung und Zustimmung finden bei deiner Bank oder dem offiziellen PSD2-Anbieter statt.'}</span></div></div><ol className="connection-steps"><li><span>1</span><div><strong>Sichere Weiterleitung</strong><small>Finance Planner sammelt keine Bank-PIN oder PayPal-Zugangsdaten.</small></div></li><li><span>2</span><div><strong>Zugriff bestätigen</strong><small>Du bestimmst beim Anbieter, welche Daten freigegeben werden.</small></div></li><li><span>3</span><div><strong>Konten auswählen</strong><small>Nach der Rückkehr entscheidest du, welche gefundenen Konten importiert werden.</small></div></li></ol><div className="privacy-box"><ShieldCheck size={18}/><span>Tokens bleiben verschlüsselt auf dem Server. Finance Planner kann keine Überweisungen ausführen.</span></div><div className="modal-actions bank-modal-actions"><button className="secondary" disabled={busy} onClick={() => setSetupStep(selectedInstitution.accountTypeRequired ? 2 : 1)}><ArrowLeft size={16}/> Zurück</button><button className="primary" disabled={busy} onClick={() => connect(selectedInstitution.provider as ConnectorProvider)}>{busy ? 'Weiterleitung wird vorbereitet …' : selectedInstitution.provider === 'paypal' ? 'Sicher zu PayPal' : 'Sicher zur Bank'} <ArrowRight size={16}/></button></div></>}
      </section>
    </div>}
  </div>
}
