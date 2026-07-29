import { useMemo, useState } from 'react'
import { AlertTriangle, BrainCircuit, ChartNoAxesCombined, Check, CircleCheck, Gauge, Info, LoaderCircle, MessageCircleQuestion, Route, Send, ShieldCheck, X } from 'lucide-react'
import { ASSISTANT_MODEL, runAssistant, type AssistantMode } from './assistant'
import { behaviorSummary } from './behavior'
import { createFinancialAgentPlan, decideAgentAction, type AgentPlan } from './financialAgent'
import { createSmartBriefing } from './smartBriefing'
import { assessSmartness } from './smartness'
import type { AppState } from './types'

const ACTION_STATUS_LABELS: Record<string, string> = { proposed: 'Vorgeschlagen', approved: 'Genehmigt', rejected: 'Abgelehnt' }
const DATA_QUALITY_LABELS: Record<string, string> = { low: 'niedrig', medium: 'mittel', high: 'hoch' }
const SMARTNESS_LEVEL_LABELS: Record<string, string> = { basic: 'Basis', adaptive: 'Adaptiv', advanced: 'Fortgeschritten' }

export function FinanceAssistant({ state }: { state: AppState }) {
  const [mode, setMode] = useState<AssistantMode>('analysis')
  const [question, setQuestion] = useState('Wie kann ich meine Sparziele schneller erreichen?')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const initialPlan = useMemo(() => createFinancialAgentPlan(state), [state])
  const [plan, setPlan] = useState<AgentPlan>(initialPlan)
  const learned = behaviorSummary()
  const smartness = useMemo(() => assessSmartness(state, learned.learnedDecisions), [state, learned.learnedDecisions])
  const briefing = useMemo(() => createSmartBriefing(state), [state])

  const run = async () => {
    setLoading(true)
    try {
      setAnswer(await runAssistant(mode, state, question))
      setPlan(createFinancialAgentPlan(state))
    } finally { setLoading(false) }
  }

  const decide = (actionId: string, decision: 'approved' | 'rejected') => setPlan((current) => decideAgentAction(current, actionId, decision))

  return <div className="assistant-page">
    <section className="panel assistant-hero">
      <div><p className="eyebrow">Lokales generatives Modell</p><h2>Analyse, Fragen und Finanzplanung</h2><p>Das Modell arbeitet mit einer kompakten Zusammenfassung deiner lokalen Daten. Geldberechnungen bleiben deterministisch.</p></div>
      <div className="ai-model"><BrainCircuit size={18}/><div><strong>{ASSISTANT_MODEL}</strong><span>Transformers.js · quantisiertes ONNX · ohne API-Key</span></div></div>
    </section>
    {briefing.length > 0 && <section className="panel smart-briefing" aria-labelledby="smart-briefing-title">
      <div className="panel-header"><div><p className="eyebrow">Automatisch priorisiert</p><h2 id="smart-briefing-title">Dein Finanzbriefing</h2></div><span className="pill">Letzte 30 Tage</span></div>
      <div className="smart-briefing-list">{briefing.map((item) => <article className={`smart-briefing-item ${item.severity}`} key={item.id}>{item.severity === 'attention' ? <AlertTriangle size={19}/> : item.severity === 'positive' ? <CircleCheck size={19}/> : <Info size={19}/>}<div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div>
    </section>}
    <section className="assistant-grid">
      <article className="panel">
        <div className="assistant-modes">
          <button className={mode === 'analysis' ? 'active' : ''} onClick={() => setMode('analysis')}><ChartNoAxesCombined size={17}/> Analyse</button>
          <button className={mode === 'question' ? 'active' : ''} onClick={() => setMode('question')}><MessageCircleQuestion size={17}/> Fragen</button>
          <button className={mode === 'planning' ? 'active' : ''} onClick={() => setMode('planning')}><Route size={17}/> Planung</button>
        </div>
        <label>Deine Frage oder dein Ziel<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5}/></label>
        <button className="primary" onClick={run} disabled={loading}>{loading ? <LoaderCircle className="spin" size={18}/> : <Send size={18}/>} {loading ? 'Modell arbeitet …' : 'Assistent starten'}</button>
      </article>
      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Verhaltenslernen</p><h2>Persönlicher Graph</h2></div><ShieldCheck size={20}/></div>
        <div className="learning-stats"><div><strong>{learned.nodes}</strong><span>Knoten</span></div><div><strong>{learned.edges}</strong><span>Beziehungen</span></div><div><strong>{learned.learnedDecisions}</strong><span>Bestätigungen</span></div></div>
        <p className="muted">Jede übernommene Händler-, Kategorie- und Wiederholungsentscheidung verstärkt lokale Graph-Beziehungen. Das Modell passt spätere Vorschläge daran an.</p>
      </article>
    </section>
    <section className="panel">
      <div className="panel-header"><div><p className="eyebrow">Messbare Smartness</p><h2>KI-Qualität: {smartness.overall}%</h2></div><Gauge size={20}/></div>
      <p className="muted">Stufe: {SMARTNESS_LEVEL_LABELS[smartness.level] ?? smartness.level}. Der Wert misst Datengrundlage, Personalisierung, Prognosefähigkeit, Erklärbarkeit und Sicherheit getrennt.</p>
      <div className="learning-stats">{smartness.dimensions.map((dimension) => <div key={dimension.key} title={dimension.evidence}><strong>{dimension.score}%</strong><span>{dimension.label}</span></div>)}</div>
      <p><strong>Nächster Qualitätsschritt:</strong> {smartness.nextMilestone}</p>
    </section>
    <section className="panel assistant-answer"><div className="panel-header"><div><p className="eyebrow">Ergebnis</p><h2>Antwort des Finanzassistenten</h2></div></div><div className="answer-text">{answer || 'Starte eine Analyse, stelle eine Frage oder lasse einen Finanzplan erstellen.'}</div></section>
    <section className="panel">
      <div className="panel-header"><div><p className="eyebrow">Freigabepflichtiger Agent</p><h2>Vorgeschlagene nächste Schritte</h2></div><span className="pill">Datenqualität: {DATA_QUALITY_LABELS[plan.dataQuality] ?? plan.dataQuality}</span></div>
      <p className="muted">Der Agent darf analysieren und Vorschläge priorisieren. Er führt niemals Zahlungen, Überweisungen oder Kontenänderungen ohne ausdrückliche Bestätigung aus.</p>
      <div className="transaction-list">{plan.actions.map((action) => <div className="transaction-row" key={action.id}><div><strong>{action.title}</strong><span>{action.rationale}{action.amountCents ? ` · ${(action.amountCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''}</span></div><span className="pill">{ACTION_STATUS_LABELS[action.status] ?? action.status}</span>{action.status === 'proposed' && <div className="row-actions"><button aria-label="Vorschlag genehmigen" onClick={() => decide(action.id, 'approved')}><Check size={16}/></button><button aria-label="Vorschlag ablehnen" onClick={() => decide(action.id, 'rejected')}><X size={16}/></button></div>}</div>)}</div>
    </section>
  </div>
}
