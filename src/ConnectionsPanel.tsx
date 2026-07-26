import { useMemo, useState, type ChangeEvent } from 'react'
import { Building2, CheckCircle2, CreditCard, FileUp, RefreshCw, RotateCcw, ShieldCheck, WalletCards } from 'lucide-react'
import { applySyncPreview, buildSyncPreview, startConnector, synchronizeConnections, type ConnectorProvider, type SyncPreview } from './connectors'
import { applyStatementImport, buildStatementPreview, parseStatement, type StatementPreview } from './statementImport'
import { getSecureValue, setSecureValue } from './vault'
import type { AppState } from './types'

interface ConnectionsPanelProps {
  state: AppState
  onApply: (state: AppState) => void
}

const BACKEND_URL_KEY = 'connector-backend-url'

const providers: Array<{ id: ConnectorProvider; title: string; description: string; icon: typeof Building2 }> = [
  { id: 'gocardless', title: 'Bankkonto (PSD2)', description: 'EU-Bankkonten über einen zugelassenen Kontoinformationsdienst verbinden.', icon: Building2 },
  { id: 'finapi', title: 'finAPI', description: 'Alternative deutsche Banking-Anbindung für produktive B2B-Integrationen.', icon: WalletCards },
  { id: 'paypal', title: 'PayPal', description: 'PayPal-Business-Transaktionen über die offizielle Reporting API synchronisieren.', icon: CreditCard },
]

export function ConnectionsPanel({ state, onApply }: ConnectionsPanelProps) {
  const [backendUrl, setBackendUrl] = useState(() => getSecureValue(BACKEND_URL_KEY, ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [previews, setPreviews] = useState<SyncPreview[]>([])
  const [statementPreview, setStatementPreview] = useState<StatementPreview | null>(null)
  const [rollbackState, setRollbackState] = useState<AppState | null>(null)

  const summary = useMemo(() => previews.reduce((result, preview) => ({
    accounts: result.accounts + preview.accountsToCreate.length,
    transactions: result.transactions + preview.transactionsToImport.length,
    duplicates: result.duplicates + preview.duplicateCount,
    pending: result.pending + preview.pendingCount,
  }), { accounts: 0, transactions: 0, duplicates: 0, pending: 0 }), [previews])

  const requireBackend = (): string => {
    const trimmed = backendUrl.trim().replace(/\/$/, '')
    if (!/^https:\/\//.test(trimmed) && !/^http:\/\/localhost(?::\d+)?$/.test(trimmed)) throw new Error('Bitte eine HTTPS-Backend-Adresse oder localhost für die Entwicklung eintragen.')
    setSecureValue(BACKEND_URL_KEY, trimmed)
    return trimmed
  }

  const connect = async (provider: ConnectorProvider) => {
    setBusy(true); setError(''); setMessage('')
    try { await startConnector(provider, requireBackend()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Verbindung konnte nicht gestartet werden.'); setBusy(false) }
  }

  const synchronize = async () => {
    setBusy(true); setError(''); setMessage(''); setPreviews([])
    try {
      const payloads = await synchronizeConnections(requireBackend())
      const next = payloads.map((payload) => buildSyncPreview(state, payload))
      setPreviews(next)
      setMessage(next.length ? 'Synchronisierung abgeschlossen. Prüfe die Vorschau vor dem Import.' : 'Keine aktiven Verbindungen gefunden.')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Synchronisierung fehlgeschlagen.') }
    finally { setBusy(false) }
  }

  const importPreview = () => {
    setRollbackState(state)
    onApply(previews.reduce((current, preview) => applySyncPreview(current, preview), state))
    setPreviews([])
    setMessage(`${summary.transactions} Transaktionen und ${summary.accounts} Konten wurden importiert.`)
  }

  const readStatement = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(''); setMessage(''); setStatementPreview(null)
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Die Datei ist größer als 5 MB.')
      const parsed = parseStatement(await file.text(), file.name)
      setStatementPreview(buildStatementPreview(state, parsed))
      setMessage(`${parsed.rows.length} Buchungen aus ${file.name} gelesen. Prüfe die Vorschau.`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kontoauszug konnte nicht gelesen werden.') }
  }

  const importStatement = () => {
    if (!statementPreview) return
    setRollbackState(state)
    onApply(applyStatementImport(state, statementPreview))
    setMessage(`${statementPreview.transactions.length} Buchungen importiert; ${statementPreview.duplicates} Duplikate übersprungen.`)
    setStatementPreview(null)
  }

  const rollback = () => {
    if (!rollbackState) return
    onApply(rollbackState)
    setRollbackState(null)
    setMessage('Der letzte Import wurde vollständig zurückgesetzt.')
  }

  return <div className="connections-page">
    <section className="panel assistant-hero"><div><p className="eyebrow">Automatische Finanzen</p><h2>Banken und PayPal verbinden</h2><p>Online-Banking-Passwörter und Provider-Secrets bleiben außerhalb des Browsers. Finanzregeln werden durch den COBOL-Kern validiert.</p></div><ShieldCheck size={32}/></section>

    <section className="panel connector-config">
      <label>Connector-Backend<input value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} placeholder="https://finance-api.example.de" inputMode="url"/></label>
      <button className="primary" disabled={busy} onClick={synchronize}><RefreshCw size={17}/>{busy ? 'Synchronisiere …' : 'Alle Verbindungen synchronisieren'}</button>
      <p className="muted">Client-Secrets, Refresh-Tokens und PSD2-Zertifikate gehören ausschließlich in den Server oder einen Secret Manager.</p>
    </section>

    <section className="connector-grid">
      {providers.map((provider) => { const Icon = provider.icon; return <article className="panel connector-card" key={provider.id}><div className="goal-hero-icon"><Icon size={24}/></div><p className="eyebrow">Offizieller Connector</p><h2>{provider.title}</h2><span>{provider.description}</span><button className="secondary data-action" disabled={busy} onClick={() => connect(provider.id)}>Verbinden</button></article> })}
    </section>

    <section className="panel statement-import">
      <div><p className="eyebrow">Fallback und Migration</p><h2>CSV- oder CAMT-Kontoauszug importieren</h2><p className="muted">Unterstützt deutsche CSV-Formate sowie CAMT.052, CAMT.053 und CAMT.054. Beträge werden als ganzzahlige Euro-Cent verarbeitet.</p></div>
      <label className="secondary file-button"><FileUp size={17}/>Datei auswählen<input type="file" accept=".csv,.xml,.camt,text/csv,application/xml,text/xml" onChange={readStatement}/></label>
    </section>

    {statementPreview && <section className="panel sync-preview"><div className="panel-header"><div><p className="eyebrow">Auszugsvorschau</p><h2>{statementPreview.account.name}</h2></div><CheckCircle2 size={24}/></div><div className="stats-grid compact"><article className="stat-card"><span>Buchungen</span><strong>{statementPreview.transactions.length}</strong></article><article className="stat-card"><span>Duplikate</span><strong>{statementPreview.duplicates}</strong></article><article className="stat-card"><span>Fehlerhafte Zeilen</span><strong>{statementPreview.rejected}</strong></article><article className="stat-card"><span>Format</span><strong>{statementPreview.format.toUpperCase()}</strong></article></div><button className="primary" disabled={!statementPreview.transactions.length} onClick={importStatement}>Geprüfte Buchungen importieren</button></section>}

    {previews.length > 0 && <section className="panel sync-preview"><div className="panel-header"><div><p className="eyebrow">Importvorschau</p><h2>Gefundene Finanzdaten</h2></div><CheckCircle2 size={24}/></div><div className="stats-grid compact"><article className="stat-card"><span>Neue Konten</span><strong>{summary.accounts}</strong></article><article className="stat-card"><span>Neue Buchungen</span><strong>{summary.transactions}</strong></article><article className="stat-card"><span>Duplikate</span><strong>{summary.duplicates}</strong></article><article className="stat-card"><span>Vorgemerkt</span><strong>{summary.pending}</strong></article></div><p className="muted">Vorgemerkte Buchungen werden nicht importiert. Duplikate werden über externe IDs und Inhaltsfingerprints erkannt.</p><button className="primary" onClick={importPreview}>Geprüfte Daten importieren</button></section>}

    {rollbackState && <button className="secondary rollback-button" onClick={rollback}><RotateCcw size={17}/>Letzten Import zurücksetzen</button>}
    {message && <p className="status-message success-message">{message}</p>}
    {error && <p className="status-message error-message" role="alert">{error}</p>}
  </div>
}
