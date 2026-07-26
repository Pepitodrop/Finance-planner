import { useMemo, useState } from 'react'
import { Building2, CheckCircle2, CreditCard, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react'
import { applySyncPreview, buildSyncPreview, startConnector, synchronizeConnections, type ConnectorProvider, type SyncPreview } from './connectors'
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

  const summary = useMemo(() => previews.reduce((result, preview) => ({
    accounts: result.accounts + preview.accountsToCreate.length,
    transactions: result.transactions + preview.transactionsToImport.length,
    duplicates: result.duplicates + preview.duplicateCount,
    pending: result.pending + preview.pendingCount,
  }), { accounts: 0, transactions: 0, duplicates: 0, pending: 0 }), [previews])

  const requireBackend = (): string => {
    const trimmed = backendUrl.trim().replace(/\/$/, '')
    if (!/^https:\/\//.test(trimmed) && !/^http:\/\/localhost(?::\d+)?$/.test(trimmed)) {
      throw new Error('Bitte eine HTTPS-Backend-Adresse oder localhost für die Entwicklung eintragen.')
    }
    setSecureValue(BACKEND_URL_KEY, trimmed)
    return trimmed
  }

  const connect = async (provider: ConnectorProvider) => {
    setBusy(true); setError(''); setMessage('')
    try {
      await startConnector(provider, requireBackend())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Verbindung konnte nicht gestartet werden.')
      setBusy(false)
    }
  }

  const synchronize = async () => {
    setBusy(true); setError(''); setMessage(''); setPreviews([])
    try {
      const payloads = await synchronizeConnections(requireBackend())
      const next = payloads.map((payload) => buildSyncPreview(state, payload))
      setPreviews(next)
      setMessage(next.length ? 'Synchronisierung abgeschlossen. Prüfe die Vorschau vor dem Import.' : 'Keine aktiven Verbindungen gefunden.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Synchronisierung fehlgeschlagen.')
    } finally { setBusy(false) }
  }

  const importPreview = () => {
    const nextState = previews.reduce((current, preview) => applySyncPreview(current, preview), state)
    onApply(nextState)
    setPreviews([])
    setMessage(`${summary.transactions} Transaktionen und ${summary.accounts} Konten wurden importiert.`)
  }

  return <div className="connections-page">
    <section className="panel assistant-hero">
      <div><p className="eyebrow">Automatische Finanzen</p><h2>Banken und PayPal verbinden</h2><p>Die App speichert niemals Online-Banking-Passwörter oder Provider-Secrets. Consent, OAuth und API-Zugriffe laufen ausschließlich über dein abgesichertes Backend.</p></div>
      <ShieldCheck size={32}/>
    </section>

    <section className="panel connector-config">
      <label>Connector-Backend<input value={backendUrl} onChange={(event) => setBackendUrl(event.target.value)} placeholder="https://finance-api.example.de" inputMode="url"/></label>
      <p className="muted">Client-IDs, Client-Secrets, Refresh-Tokens und PSD2-Zertifikate gehören nur in den Server beziehungsweise einen Secret Manager.</p>
      <button className="primary" disabled={busy} onClick={synchronize}><RefreshCw size={17}/>{busy ? 'Synchronisiere …' : 'Alle Verbindungen synchronisieren'}</button>
    </section>

    <section className="connector-grid">
      {providers.map((provider) => { const Icon = provider.icon; return <article className="panel connector-card" key={provider.id}>
        <div className="goal-hero-icon"><Icon size={24}/></div>
        <p className="eyebrow">Offizieller Connector</p><h2>{provider.title}</h2><span>{provider.description}</span>
        <button className="secondary data-action" disabled={busy} onClick={() => connect(provider.id)}>Verbinden</button>
      </article> })}
    </section>

    {previews.length > 0 && <section className="panel sync-preview">
      <div className="panel-header"><div><p className="eyebrow">Importvorschau</p><h2>Gefundene Finanzdaten</h2></div><CheckCircle2 size={24}/></div>
      <div className="stats-grid compact"><article className="stat-card"><span>Neue Konten</span><strong>{summary.accounts}</strong></article><article className="stat-card"><span>Neue Buchungen</span><strong>{summary.transactions}</strong></article><article className="stat-card"><span>Duplikate</span><strong>{summary.duplicates}</strong></article><article className="stat-card"><span>Vorgemerkt</span><strong>{summary.pending}</strong></article></div>
      <p className="muted">Vorgemerkte Buchungen werden noch nicht importiert. Duplikate werden anhand externer IDs sowie Konto, Datum, Betrag und Beschreibung erkannt.</p>
      <button className="primary" onClick={importPreview}>Geprüfte Daten importieren</button>
    </section>}

    {message && <p className="status-message success-message">{message}</p>}
    {error && <p className="status-message error-message" role="alert">{error}</p>}
  </div>
}
