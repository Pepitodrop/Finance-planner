import { useMemo, useState } from 'react'
import { BrainCircuit, Check, LoaderCircle, ScanSearch, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react'
import { classifyTransaction, generateInsights, HUGGING_FACE_MODEL, type AiSuggestion } from './ai'
import { formatMoney } from './finance'
import type { Transaction } from './types'

interface AiPanelProps {
  transactions: Transaction[]
  onApply: (transactionId: string, suggestion: AiSuggestion) => void
}

export function AiPanel({ transactions, onApply }: AiPanelProps) {
  const [suggestions, setSuggestions] = useState<Record<string, AiSuggestion>>({})
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('Bereit')
  const insights = useMemo(() => generateInsights(transactions), [transactions])

  const analyze = async () => {
    setLoading(true)
    const next: Record<string, AiSuggestion> = {}
    try {
      for (let index = 0; index < transactions.length; index += 1) {
        const transaction = transactions[index]
        setProgress(`Analysiere ${index + 1} von ${transactions.length}: ${transaction.description}`)
        next[transaction.id] = await classifyTransaction(transaction.description, transaction.amountCents, transactions)
        setSuggestions({ ...next })
      }
      setProgress('Analyse abgeschlossen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ai-page">
      <section className="panel ai-hero">
        <div className="ai-hero-copy">
          <span className="ai-badge"><Sparkles size={14} /> Kostenlose lokale KI</span>
          <h2>Finance Intelligence</h2>
          <p>Die App lädt ein quantisiertes, mehrsprachiges Hugging-Face-Modell in deinen Browser. Buchungstexte werden lokal verarbeitet; es ist kein API-Key nötig.</p>
          <div className="ai-model"><BrainCircuit size={18} /><div><strong>{HUGGING_FACE_MODEL}</strong><span>Transformers.js · ONNX · 50 Sprachen · Apache-2.0-Basismodell</span></div></div>
        </div>
        <button className="primary ai-run" onClick={analyze} disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={19} /> : <WandSparkles size={19} />}
          {loading ? 'KI arbeitet …' : 'Alle Buchungen analysieren'}
        </button>
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
          <p className="ai-status">{progress}</p>
          <div className="privacy-box"><ShieldCheck size={17} /><span>Die Modell-Dateien werden einmalig von Hugging Face geladen und anschließend vom Browser gecacht. Deine Transaktionen werden nicht an einen KI-API-Endpunkt gesendet.</span></div>
        </article>
      </section>

      <section className="panel table-panel ai-results">
        <div className="panel-header"><div><p className="eyebrow">Erklärbare Vorschläge</p><h2>KI-Analyse der Buchungen</h2></div><span className="pill">{Object.keys(suggestions).length} analysiert</span></div>
        <div className="ai-result-list">
          {transactions.map((transaction) => {
            const suggestion = suggestions[transaction.id]
            return (
              <div className="ai-result" key={transaction.id}>
                <div className="ai-result-main">
                  <strong>{transaction.description}</strong>
                  <span>{formatMoney(transaction.amountCents)} · aktuell: {transaction.category}</span>
                </div>
                {suggestion ? <>
                  <div className="ai-prediction"><b>{suggestion.merchant}</b><span>{suggestion.category} · {suggestion.confidence}% sicher</span></div>
                  <div className="ai-scores"><span>Wiederkehrend {suggestion.recurringProbability}%</span><span>Anomalie {suggestion.anomalyScore}%</span></div>
                  <p>{suggestion.explanation}</p>
                  <button className="secondary" onClick={() => onApply(transaction.id, suggestion)}><Check size={15} /> Übernehmen</button>
                </> : <span className="ai-waiting">Noch nicht analysiert</span>}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
