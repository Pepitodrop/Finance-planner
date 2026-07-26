import { useMemo, useState } from 'react'
import { AlertTriangle, BrainCircuit, Check, CheckCheck, Filter, LoaderCircle, RefreshCw, ScanSearch, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react'
import { classifyTransaction, generateInsights, HUGGING_FACE_MODEL, type AiSuggestion } from './ai'
import { buildAiReviewSummary, isTrustedSuggestion, matchesAiReviewFilter, requiresHumanReview, type AiReviewFilter } from './aiReview'
import { formatMoney } from './finance'
import type { Transaction } from './types'
import './ai.css'

interface AiPanelProps {
  transactions: Transaction[]
  onApply: (transactionId: string, suggestion: AiSuggestion) => void
}

const filters: Array<{ key: AiReviewFilter; label: string }> = [
  { key: 'all', label: 'Alle' },
  { key: 'trusted', label: 'Verlässlich' },
  { key: 'review', label: 'Prüfen' },
  { key: 'recurring', label: 'Wiederkehrend' },
  { key: 'anomaly', label: 'Anomalien' },
]

export function AiPanel({ transactions, onApply }: AiPanelProps) {
  const [suggestions, setSuggestions] = useState<Record<string, AiSuggestion>>({})
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('Bereit')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<AiReviewFilter>('all')
  const insights = useMemo(() => generateInsights(transactions), [transactions])
  const summary = useMemo(() => buildAiReviewSummary(suggestions), [suggestions])
  const visibleTransactions = useMemo(
    () => transactions.filter((transaction) => matchesAiReviewFilter(suggestions[transaction.id], filter)),
    [filter, suggestions, transactions],
  )

  const analyze = async () => {
    setLoading(true)
    setError('')
    const next: Record<string, AiSuggestion> = {}
    try {
      for (let index = 0; index < transactions.length; index += 1) {
        const transaction = transactions[index]
        setProgress(`Analysiere ${index + 1} von ${transactions.length}: ${transaction.description}`)
        next[transaction.id] = await classifyTransaction(transaction.description, transaction.amountCents, transactions)
        setSuggestions({ ...next })
      }
      setProgress('Analyse abgeschlossen')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Die KI-Analyse konnte nicht abgeschlossen werden.')
      setProgress('Analyse unterbrochen')
    } finally {
      setLoading(false)
    }
  }

  const applyTrusted = () => {
    for (const transaction of transactions) {
      const suggestion = suggestions[transaction.id]
      if (suggestion && isTrustedSuggestion(suggestion)) onApply(transaction.id, suggestion)
    }
  }

  return (
    <div className="ai-page">
      <section className="panel ai-hero">
        <div className="ai-hero-copy">
          <span className="ai-badge"><Sparkles size={14} /> Kostenlose lokale KI</span>
          <h2>Finance Intelligence</h2>
          <p>Die App kombiniert persönliche Lernsignale, deterministische Regeln und lokale Hugging-Face-Modelle. Nur verlässliche Vorschläge werden für eine Sammelübernahme freigegeben; unsichere Entscheidungen bleiben in der Prüfwarteschlange.</p>
          <div className="ai-model"><BrainCircuit size={18} /><div><strong>{HUGGING_FACE_MODEL}</strong><span>Transformers.js · ONNX · lokale Inferenz · erklärbare Alternativen</span></div></div>
        </div>
        <div className="ai-actions">
          <button className="primary ai-run" onClick={analyze} disabled={loading || transactions.length === 0}>
            {loading ? <LoaderCircle className="spin" size={19} /> : <WandSparkles size={19} />}
            {loading ? 'KI arbeitet …' : summary.analyzed ? 'Erneut analysieren' : 'Alle Buchungen analysieren'}
          </button>
          <button className="secondary" onClick={applyTrusted} disabled={summary.trusted === 0 || loading}>
            <CheckCheck size={17} /> {summary.trusted} verlässliche übernehmen
          </button>
        </div>
      </section>

      <section className="ai-metrics" aria-label="KI-Qualitätsübersicht">
        <article className="panel"><span>Analysiert</span><strong>{summary.analyzed}</strong><small>von {transactions.length} Buchungen</small></article>
        <article className="panel"><span>Ø Konfidenz</span><strong>{summary.averageConfidence}%</strong><small>kalibrierte Sicherheit</small></article>
        <article className="panel"><span>Verlässlich</span><strong>{summary.trusted}</strong><small>automatisierbare Vorschläge</small></article>
        <article className="panel"><span>Prüfung nötig</span><strong>{summary.needsReview}</strong><small>menschliche Bestätigung</small></article>
        <article className="panel"><span>Anomalien</span><strong>{summary.anomalies}</strong><small>Score ab 70%</small></article>
      </section>

      <section className="ai-grid">
        <article className="panel">
          <div className="panel-header"><div><p className="eyebrow">Persönlicher Assistent</p><h2>Smart Insights</h2></div><ShieldCheck size={20} /></div>
          <div className="insight-list">
            {insights.map((insight) => <div key={insight}><Sparkles size={16} /><span>{insight}</span></div>)}
          </div>
        </article>
        <article className="panel">
          <div className="panel-header"><div><p className="eyebrow">Status</p><h2>Lokale Inferenz</h2></div><ScanSearch size={20} /></div>
          <p className="ai-status" role="status">{progress}</p>
          {error && <div className="ai-error" role="alert"><AlertTriangle size={17}/><span>{error}</span><button onClick={analyze}><RefreshCw size={14}/> Erneut versuchen</button></div>}
          <div className="privacy-box"><ShieldCheck size={17} /><span>Modell-Dateien werden im Browser gecacht. Transaktionen werden nicht an einen externen KI-API-Endpunkt gesendet. Unsichere Ergebnisse werden nicht automatisch angewendet.</span></div>
        </article>
      </section>

      <section className="panel table-panel ai-results">
        <div className="panel-header ai-results-header">
          <div><p className="eyebrow">Erklärbare Vorschläge</p><h2>KI-Prüfwarteschlange</h2></div>
          <div className="ai-filter" aria-label="Vorschläge filtern"><Filter size={15}/>{filters.map((item) => <button key={item.key} className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
        </div>
        <div className="ai-result-list">
          {visibleTransactions.map((transaction) => {
            const suggestion = suggestions[transaction.id]
            const reviewRequired = suggestion ? requiresHumanReview(suggestion) : false
            return (
              <div className={`ai-result ${reviewRequired ? 'review-required' : ''}`} key={transaction.id}>
                <div className="ai-result-main">
                  <strong>{transaction.description}</strong>
                  <span>{formatMoney(transaction.amountCents)} · aktuell: {transaction.category}</span>
                </div>
                {suggestion ? <>
                  <div className="ai-prediction"><b>{suggestion.merchant}</b><span>{suggestion.category} · {suggestion.confidence}% sicher</span><em>{suggestion.source}</em></div>
                  <div className="ai-scores"><span>Wiederkehrend {suggestion.recurringProbability}%</span><span className={suggestion.anomalyScore >= 70 ? 'warning' : ''}>Anomalie {suggestion.anomalyScore}%</span></div>
                  <div className="ai-explanation"><p>{suggestion.explanation}</p>{suggestion.alternatives.length > 1 && <div className="ai-alternatives">Alternativen: {suggestion.alternatives.slice(1, 4).map((alternative) => <span key={alternative.category}>{alternative.category} {alternative.confidence}%</span>)}</div>}</div>
                  <div className="ai-decision"><span className={reviewRequired ? 'review-badge' : 'trusted-badge'}>{reviewRequired ? 'Bitte prüfen' : 'Verlässlich'}</span><button className="secondary" onClick={() => onApply(transaction.id, suggestion)}><Check size={15} /> Übernehmen</button></div>
                </> : <span className="ai-waiting">Noch nicht analysiert</span>}
              </div>
            )
          })}
          {visibleTransactions.length === 0 && <div className="ai-empty">Keine Vorschläge entsprechen diesem Filter.</div>}
        </div>
      </section>
    </div>
  )
}
