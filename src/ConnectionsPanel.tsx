import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, BrainCircuit, Building2, CheckCircle2, CreditCard, FileUp, RefreshCw, RotateCcw, Search, ShieldCheck, Unplug, WalletCards, X } from 'lucide-react'
import { applySyncPreview, buildSyncPreview, consentDaysRemaining, disconnectConnector, startConnector, synchronizeConnections, type ConnectorConnection, type ConnectorProvider, type SyncPreview } from './connectors'
import { applyStatementImport, buildStatementPreview, parseStatement, type StatementPreview } from './statementImport'
import type { AppState } from './types'

interface ConnectionsPanelProps { state: AppState; onApply: (state: AppState) => void }

type BankOption = {
  id: ConnectorProvider
  title: string
  description: string
  icon: typeof Building2
  kind: 'bank' | 'wallet'
  searchTerms: string
}

const providers: BankOption[] = [
  { id: 'gocardless', title: 'Bankkonto', description: 'Die meisten deutschen und europäischen Banken sicher über PSD2 verbinden.', icon: Building2, kind: 'bank', searchTerms: 'bank girokonto sparkasse volksbank deutsche bank comdirect ing dkb n26 europäische bank' },
  { id: 'finapi', title: 'Bankkonto über finAPI', description: 'Alternative deutsche Banking-Anbindung, falls deine Bank dort besser unterstützt wird.', icon: WalletCards, kind: 'bank', searchTerms: 'finapi deutsche bank sparkasse volksbank girokonto bank' },
  { id: 'paypal', title: 'PayPal', description: 'PayPal-Business-Transaktionen über die offizielle Reporting API synchronisieren.', icon: CreditCard, kind: 'wallet', searchTerms: 'paypal wallet zahlungsanbieter' },
]

export function ConnectionsPanel({ state, onApply }: ConnectionsPanelProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [connections, setConnections] = useState<ConnectorConnection[]>([])
  const [previews, setPreviews] = useState<SyncPreview[]>([])
  const [statementPreview, setStatementPreview] = useState<StatementPreview | null>(null)
  const [rollbackState, setRollbackState] = useState<AppState | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [setupStep, setSetupStep] = useState<1 | 2>(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedProvider, setSelectedProvider] = useState<ConnectorProvider | null>(null)

  const summary = useMemo(() => previews.reduce((result, preview) => ({
    accounts: result.accounts + preview.accountsToCreate.length,
    transactions: result.transactions + preview.transactionsToImport.length,
    duplicates: result.duplicates + preview.duplicateCount,
    pending: result.pending + preview.pendingCount,
    smartCategorized: result.smartCategorized + preview.quality.smartCategorized,
    needsReview: result.needsReview + preview.quality.needsReview,
    qualityTotal: result.qualityTotal + preview.quality.score,
  }), { accounts: 0, transactions: 0, duplicates: 0, pending: 0, smartCategorized: 0, needsReview: 0, qualityTotal: 0 }), [previews])
  const averageQuality = previews.length ? Math.round(summary.qualityTotal / previews.length) : 0
  const qualityWarnings = [...new Set(previews.flatMap((preview) => preview.quality.warnings))]
  const filteredProviders = providers.filter((provider) => `${provider.title} ${provider.description} ${provider.searchTerms}`.toLocaleLowerCase('de-DE').includes(searchTerm.trim().toLocaleLowerCase('de-DE')))
  const selected = providers.find((provider) => provider.id === selectedProvider) ?? null

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const provider = params.get('provider')
    const callbackError = params.get('error_description') || params.get('error')
    const callbackCompleted = params.has('code') || params.has('state')
    if (!provider && !callbackError && !callbackCompleted) return

    const cleanUrl = new URL(window.location.href)
    for (const key of ['code', 'state', 'scope', 'error', 'error_description', 'provider']) cleanUrl.searchParams.delete(key)
    window.history.replaceState({}, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)

    if (callbackError) {
      setError(`Die Bankverbindung wurde nicht abgeschlossen: ${callbackError}`)
      return
    }

    setMessage('Bank bestätigt. Die Verbindung wird jetzt geprüft und die ersten Daten werden synchronisiert.')
    void synchronize()
  }, [])

  const connect = async (provider: ConnectorProvider) => {
    setBusy(true)
    setError('')
    setMessage('Du wirst jetzt sicher zu deiner Bank weitergeleitet. Finance Planner erhält niemals dein Online-Banking-Passwort.')
    try {
      await startConnector(provider)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verbindung konnte nicht gestartet werden.')
      setBusy(false)
    }
  }

  const synchronize = async () => {
    setBusy(true)
    setError('')
    setPreviews([])
    try {
      const payloads = await synchronizeConnections()
      setConnections(payloads.map((payload) => payload.connection))
      const successful = payloads.filter((payload) => payload.connection.status !== 'error')
      const next = successful.map((payload) => buildSyncPreview(state, payload))
      setPreviews(next)
      const failed = payloads.filter((payload) => payload.connection.status === 'error')
      setMessage(next.length ? `Aktualisierung abgeschlossen. ${failed.length ? `${failed.length} Verbindung(en) benötigen Aufmerksamkeit. ` : ''}Prüfe die Vorschau und übernimm anschließend die Daten.` : failed.length ? 'Keine Verbindung konnte erfolgreich aktualisiert werden.' : 'Noch kein Konto verbunden.')
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

  const openSetup = () => {
    setSetupStep(1)
    setSearchTerm('')
    setSelectedProvider(null)
    setSetupOpen(true)
  }

  const chooseProvider = (provider: ConnectorProvider) => {
    setSelectedProvider(provider)
    setSetupStep(2)
  }

  const importPreview = () => { setRollbackState(state); onApply(previews.reduce((current, preview) => applySyncPreview(current, preview), state)); setPreviews([]); setMessage(`${summary.transactions} Transaktionen und ${summary.accounts} Konten wurden übernommen.`) }
  const readStatement = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setError(''); setMessage(''); setStatementPreview(null); try { if (file.size > 5 * 1024 * 1024) throw new Error('Die Datei ist größer als 5 MB.'); const parsed = parseStatement(await file.text(), file.name); setStatementPreview(buildStatementPreview(state, parsed)); setMessage(`${parsed.rows.length} Buchungen aus ${file.name} gelesen. Prüfe die Vorschau.`) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kontoauszug konnte nicht gelesen werden.') } }
  const importStatement = () => { if (!statementPreview) return; setRollbackState(state); onApply(applyStatementImport(state, statementPreview)); setMessage(`${statementPreview.transactions.length} Buchungen importiert; ${statementPreview.duplicates} Duplikate übersprungen.`); setStatementPreview(null) }
  const rollback = () => { if (!rollbackState) return; onApply(rollbackState); setRollbackState(null); setMessage('Der letzte Import wurde vollständig zurückgesetzt.') }

  return <div className="connections-page">
    <section className="panel bank-setup-hero">
      <div>
        <p className="eyebrow">Automatisch aktuell</p>
        <h2>Deine Finanzen in wenigen Schritten verbinden</h2>
        <p>Bank auswählen, bei der Bank anmelden und Zugriff bestätigen. Danach werden Konten und Buchungen automatisch aktualisiert.</p>
        <div className="bank-trust-row"><span><ShieldCheck size={16}/> PSD2-geschützt</span><span><CheckCircle2 size={16}/> Jederzeit widerrufbar</span><span><CheckCircle2 size={16}/> Kein Passwort bei uns</span></div>
      </div>
      <button className="primary bank-connect-primary" disabled={busy} onClick={openSetup}><Building2 size={18}/> Bankkonto verbinden</button>
    </section>

    <section className="panel connection-overview">
      <div className="panel-header"><div><p className="eyebrow">Meine Verbindungen</p><h2>{connections.length ? `${connections.length} aktive Verbindung${connections.length === 1 ? '' : 'en'}` : 'Noch kein Konto verbunden'}</h2></div>{connections.length > 0 && <button className="secondary" disabled={busy} onClick={synchronize}><RefreshCw size={17}/>{busy ? 'Aktualisiere …' : 'Alle aktualisieren'}</button>}</div>
      {connections.length === 0 ? <div className="connection-empty-state"><div className="goal-hero-icon"><Building2 size={24}/></div><strong>Starte mit deinem Hauptkonto</strong><span>Die Einrichtung dauert normalerweise weniger als zwei Minuten.</span><button className="secondary" onClick={openSetup}>Erste Bank verbinden <ArrowRight size={16}/></button></div> : <div className="connection-health-list">{connections.map((connection) => { const days = consentDaysRemaining(connection); const needsAttention = connection.status === 'error' || (days !== null && days <= 7); return <div className="account-row connection-row" key={connection.id}><div className="account-icon">{needsAttention ? <AlertTriangle size={19}/> : <CheckCircle2 size={19}/>}</div><div><strong>{connection.displayName}</strong><span>{connection.status === 'error' ? connection.error || 'Verbindung benötigt Aufmerksamkeit' : connection.lastSyncAt ? `Zuletzt aktualisiert: ${new Date(connection.lastSyncAt).toLocaleString('de-DE')}` : 'Sicher verbunden'}{days !== null ? ` · Zustimmung ${days < 0 ? 'abgelaufen' : `noch ${days} Tage gültig`}` : ''}</span></div><div className="connection-row-actions">{needsAttention && <button className="secondary" onClick={() => connect(connection.provider)}>Erneut verbinden</button>}<button className="secondary" disabled={busy} onClick={() => disconnect(connection.provider)}><Unplug size={16}/> Trennen</button></div></div> })}</div>}
    </section>

    <section className="panel statement-import"><div><p className="eyebrow">Ohne Bankverbindung</p><h2>Kontoauszug importieren</h2><p className="muted">CSV sowie CAMT.052, CAMT.053 und CAMT.054 werden unterstützt. Vor dem Import siehst du immer eine Vorschau.</p></div><label className="secondary file-button"><FileUp size={17}/>Datei auswählen<input type="file" accept=".csv,.xml,.camt,text/csv,application/xml,text/xml" onChange={readStatement}/></label></section>

    {statementPreview && <section className="panel sync-preview"><div className="panel-header"><div><p className="eyebrow">Auszugsvorschau</p><h2>{statementPreview.account.name}</h2></div><CheckCircle2 size={24}/></div><div className="stats-grid compact"><article className="stat-card"><span>Buchungen</span><strong>{statementPreview.transactions.length}</strong></article><article className="stat-card"><span>Duplikate</span><strong>{statementPreview.duplicates}</strong></article><article className="stat-card"><span>Fehlerhafte Zeilen</span><strong>{statementPreview.rejected}</strong></article><article className="stat-card"><span>Format</span><strong>{statementPreview.format.toUpperCase()}</strong></article></div><button className="primary" disabled={!statementPreview.transactions.length} onClick={importStatement}>Geprüfte Buchungen importieren</button></section>}
    {previews.length > 0 && <section className="panel sync-preview"><div className="panel-header"><div><p className="eyebrow">Importvorschau</p><h2>Bankdaten-Qualität: {averageQuality}%</h2></div><BrainCircuit size={24}/></div><div className="stats-grid compact"><article className="stat-card"><span>Neue Konten</span><strong>{summary.accounts}</strong></article><article className="stat-card"><span>Neue Buchungen</span><strong>{summary.transactions}</strong></article><article className="stat-card"><span>Automatisch kategorisiert</span><strong>{summary.smartCategorized}</strong></article><article className="stat-card"><span>Prüfung nötig</span><strong>{summary.needsReview}</strong></article></div><p className="muted">Vorgemerkte Buchungen werden nicht importiert. Duplikate werden automatisch erkannt. Du entscheidest erst nach der Vorschau, welche Daten übernommen werden.</p>{qualityWarnings.length > 0 && <div className="privacy-box"><ShieldCheck size={17}/><span>{qualityWarnings.join(' ')}</span></div>}<button className="primary" onClick={importPreview}>Geprüfte Daten übernehmen</button></section>}
    {rollbackState && <button className="secondary rollback-button" onClick={rollback}><RotateCcw size={17}/>Letzten Import zurücksetzen</button>}
    {message && <p className="status-message success-message" role="status">{message}</p>}{error && <p className="status-message error-message" role="alert">{error}</p>}

    {setupOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSetupOpen(false) }}>
      <section className="modal bank-setup-modal" role="dialog" aria-modal="true" aria-labelledby="bank-setup-title">
        <div className="bank-setup-modal-header"><div><p className="eyebrow">Schritt {setupStep} von 2</p><h2 id="bank-setup-title">{setupStep === 1 ? 'Was möchtest du verbinden?' : 'Sicher bei der Bank bestätigen'}</h2></div><button className="icon-button" aria-label="Einrichtung schließen" disabled={busy} onClick={() => setSetupOpen(false)}><X size={20}/></button></div>
        <div className="setup-progress" aria-hidden="true"><span className="active"/><span className={setupStep === 2 ? 'active' : ''}/></div>

        {setupStep === 1 && <>
          <label className="bank-search"><Search size={18}/><input autoFocus value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Bank oder Anbieter suchen"/></label>
          <div className="bank-picker-list">{filteredProviders.map((provider) => { const Icon = provider.icon; const connected = connections.some((connection) => connection.provider === provider.id && connection.status === 'connected'); return <button className="bank-picker-item" key={provider.id} disabled={connected} onClick={() => chooseProvider(provider.id)}><span className="bank-picker-icon"><Icon size={22}/></span><span><strong>{provider.title}</strong><small>{connected ? 'Bereits verbunden' : provider.description}</small></span><ArrowRight size={18}/></button> })}</div>
          {filteredProviders.length === 0 && <div className="connection-empty-state compact"><strong>Keine passende Bank gefunden</strong><span>Versuche den Namen deiner Bank oder nutze den Kontoauszug-Import.</span></div>}
        </>}

        {setupStep === 2 && selected && <>
          <div className="provider-confirmation"><span className="bank-picker-icon"><selected.icon size={26}/></span><div><strong>{selected.title}</strong><span>{selected.description}</span></div></div>
          <ol className="connection-steps"><li><span>1</span><div><strong>Weiterleitung zur Bank</strong><small>Die Anmeldung findet ausschließlich bei deiner Bank oder dem offiziellen Anbieter statt.</small></div></li><li><span>2</span><div><strong>Zugriff auswählen</strong><small>Du bestimmst, welche Konten Finance Planner lesen darf.</small></div></li><li><span>3</span><div><strong>Automatisch zurückkehren</strong><small>Nach der Bestätigung werden deine Konten sicher synchronisiert.</small></div></li></ol>
          <div className="privacy-box"><ShieldCheck size={18}/><span>Finance Planner sieht weder PIN noch Online-Banking-Passwort und kann keine Überweisungen ausführen.</span></div>
          <div className="modal-actions bank-modal-actions"><button className="secondary" disabled={busy} onClick={() => setSetupStep(1)}><ArrowLeft size={16}/> Zurück</button><button className="primary" disabled={busy} onClick={() => connect(selected.id)}>{busy ? 'Weiterleitung wird vorbereitet …' : 'Sicher zur Bank'} <ArrowRight size={16}/></button></div>
        </>}
      </section>
    </div>}
  </div>
}
