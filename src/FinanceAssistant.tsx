import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, BrainCircuit, ChartNoAxesCombined, Check, CircleCheck, Gauge, HardDrive, Info, LoaderCircle, MessageCircleQuestion, Route, Send, Server, ShieldCheck, X } from 'lucide-react'
import { FALLBACK_LOCAL_ASSISTANT_MODEL, HOSTED_ASSISTANT_MODEL, HostedAiFallbackError, PRIMARY_LOCAL_ASSISTANT_MODEL, runAssistant, runDeterministicAssistant, type AssistantEngine, type AssistantMode } from './assistant'
import { behaviorSummary } from './behavior'
import { createFinancialAgentPlan, decideAgentAction, type AgentPlan } from './financialAgent'
import { ACTION_STATUS_LABELS, DATA_QUALITY_LABELS, SMARTNESS_LEVEL_LABELS } from './financeLabels'
import { LearningBudgetPlanner } from './LearningBudgetPlanner'
import { createSmartBriefing } from './smartBriefing'
import { assessSmartness } from './smartness'
import type { AppState } from './types'

export function FinanceAssistant({ state }: { state: AppState }) {
  const [mode, setMode] = useState<AssistantMode>('analysis')
  const [engine, setEngine] = useState<AssistantEngine>('hosted')
  const [consentExternalAi, setConsentExternalAi] = useState(false)
  const [question, setQuestion] = useState('Wie kann ich meine Sparziele schneller erreichen?')
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const answerRef = useRef<HTMLElement | null>(null)
  const initialPlan = useMemo(() => createFinancialAgentPlan(state), [state])
  const [plan, setPlan] = useState<AgentPlan>(initialPlan)
  const learned = behaviorSummary()
  const smartness = useMemo(() => assessSmartness(state, learned.learnedDecisions), [state, learned.learnedDecisions])
  const briefing = useMemo(() => createSmartBriefing(state), [state])

  const run = async () => {
    if (!question.trim() || loading || (engine === 'hosted' && !consentExternalAi)) return
    setLoading(true); setError(''); setAnswer(''); setStartedAt(Date.now())
    requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    try {
      const result = await runAssistant(mode, state, question.trim(), engine, consentExternalAi)
      setAnswer(result)
      setPlan(createFinancialAgentPlan(state))
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Die Analyse konnte nicht erstellt werden.'
      const fallback = reason instanceof HostedAiFallbackError
        ? reason.fallbackAnswer
        : runDeterministicAssistant(mode, state, question.trim())
      const fallbackNote = reason instanceof HostedAiFallbackError
        ? 'Hinweis: Die gehosteten Modelle konnten keine verifizierbare Antwort liefern. Diese regelbasierte Ersatzanalyse stammt vom Finance-Planner-Server und kann erneut angefragt werden.'
        : 'Hinweis: Die KI-Ausführung ist fehlgeschlagen. Die oben angezeigte Ersatzanalyse wurde ausschließlich aus den lokal berechneten Finanzwerten erstellt.'
      setError(message)
      setAnswer(`${fallback}\n\n${fallbackNote}`)
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } finally { setLoading(false); setStartedAt(null) }
  }

  const decide = (actionId: string, decision: 'approved' | 'rejected') => setPlan((current) => decideAgentAction(current, actionId, decision))
  const activeModel = engine === 'hosted' ? HOSTED_ASSISTANT_MODEL : `${PRIMARY_LOCAL_ASSISTANT_MODEL} (Fallback: ${FALLBACK_LOCAL_ASSISTANT_MODEL})`
  const hostedConsentMissing = engine === 'hosted' && !consentExternalAi

  return <div className="assistant-page">
    <section className="panel assistant-hero">
      <div><p className="eyebrow">Wählbare KI-Ausführung</p><h2>Analyse, Fragen und Finanzplanung</h2><p>Die gehosteten Qwen-Modelle sind der schnelle Standard. Die lokalen Modelle bleiben verfügbar und werden nur nach ausdrücklicher Auswahl geladen.</p></div>
      <div className="ai-model"><BrainCircuit size={18}/><div><strong>{activeModel}</strong><span>{engine === 'hosted' ? 'Serverseitiges Analyst-Kritiker-Ensemble' : 'Lokal im Browser · großer einmaliger Modelldownload'}</span></div></div>
    </section>
    {briefing.length > 0 && <section className="panel smart-briefing" aria-labelledby="smart-briefing-title"><div className="panel-header"><div><p className="eyebrow">Automatisch priorisiert</p><h2 id="smart-briefing-title">Dein Finanzbriefing</h2></div><span className="pill">Monat bis heute</span></div><div className="smart-briefing-list">{briefing.map((item) => <article className={`smart-briefing-item ${item.severity}`} key={item.id}>{item.severity === 'attention' ? <AlertTriangle size={19}/> : item.severity === 'positive' ? <CircleCheck size={19}/> : <Info size={19}/>}<div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div></section>}
    <section className="assistant-grid">
      <article className="panel">
        <div className="assistant-modes"><button className={mode === 'analysis' ? 'active' : ''} onClick={() => setMode('analysis')}><ChartNoAxesCombined size={17}/> Analyse</button><button className={mode === 'question' ? 'active' : ''} onClick={() => setMode('question')}><MessageCircleQuestion size={17}/> Fragen</button><button className={mode === 'planning' ? 'active' : ''} onClick={() => setMode('planning')}><Route size={17}/> Planung</button></div>
        <div className="segmented" aria-label="KI-Modell auswählen"><button type="button" className={engine === 'hosted' ? 'active' : ''} onClick={() => { setEngine('hosted'); setError('') }} disabled={loading}><Server size={16}/> Gehostete Modelle</button><button type="button" className={engine === 'local' ? 'active' : ''} onClick={() => { setEngine('local'); setError('') }} disabled={loading}><HardDrive size={16}/> Lokale Modelle</button></div>
        {engine === 'hosted' && <label className="checkbox"><input type="checkbox" checked={consentExternalAi} onChange={(event) => setConsentExternalAi(event.target.checked)} disabled={loading}/><span>Ich stimme für diese Sitzung zu, dass ausschließlich aggregierte Finanzkennzahlen und meine Frage über den Finance-Planner-Server an die konfigurierten Hugging-Face-Modelle gesendet werden. Transaktionsbeschreibungen, Kontonamen und Zugangsdaten werden nicht übermittelt.</span></label>}
        {engine === 'local' && <p className="status-message" role="status"><Info size={18}/><span>Das lokale Modell bleibt erhalten, wird aber erst beim Start geladen. Der erste Lauf kann mehrere hundert Megabyte herunterladen und den Browser deutlich stärker belasten.</span></p>}
        <label>Deine Frage oder dein Ziel<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5}/></label>
        <button className="primary" onClick={run} disabled={loading || !question.trim() || hostedConsentMissing}>{loading ? <LoaderCircle className="spin" size={18}/> : <Send size={18}/>} {loading ? engine === 'local' ? 'Lokales Modell arbeitet …' : 'Analyse läuft …' : hostedConsentMissing ? 'Zustimmung erforderlich' : 'Assistent starten'}</button>
        {loading && <div className="status-message" role="status"><LoaderCircle className="spin" size={18}/><div><strong>{engine === 'local' ? 'Lokales Modell wird geladen und ausgeführt' : 'Deine Finanzanalyse wird erstellt'}</strong><span>{engine === 'local' ? 'Beim ersten Lauf werden Modelldateien geladen. Spätere Läufe können den Browser-Cache verwenden.' : 'Daten werden zusammengefasst, Modelle abgeglichen und die Antwort vorbereitet. Das kann bis zu einer Minute dauern.'}</span>{startedAt && <small>Anfrage gestartet um {new Date(startedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small>}</div></div>}
      </article>
      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Verhaltenslernen</p><h2>Persönlicher Graph</h2></div><ShieldCheck size={20}/></div><div className="learning-stats"><div><strong>{learned.nodes}</strong><span>Knoten</span></div><div><strong>{learned.edges}</strong><span>Beziehungen</span></div><div><strong>{learned.learnedDecisions}</strong><span>Bestätigungen</span></div></div><p className="muted">Jede übernommene Händler-, Kategorie- und Wiederholungsentscheidung verstärkt lokale Graph-Beziehungen.</p></article>
    </section>
    <section ref={answerRef} className="panel assistant-answer" aria-live="polite"><div className="panel-header"><div><p className="eyebrow">{loading ? 'In Bearbeitung' : answer ? error ? 'Regelbasierte Ersatzanalyse' : 'Analyse fertig' : 'Ergebnis'}</p><h2>Antwort des Finanzassistenten</h2></div>{answer && !error && <CircleCheck size={22}/>}</div>{error && <div className="status-message error-message" role="alert"><X size={18}/><div><strong>KI-Ausführung nicht erfolgreich</strong><span>{error}</span><button className="secondary" onClick={run} disabled={hostedConsentMissing}>Erneut versuchen</button></div></div>}<div className="answer-text">{loading ? 'Die Antwort erscheint hier automatisch, sobald die Analyse abgeschlossen ist.' : answer || 'Starte eine Analyse, stelle eine Frage oder lasse einen Finanzplan erstellen.'}</div></section>
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">Messbare Smartness</p><h2>KI-Qualität: {smartness.overall}%</h2></div><Gauge size={20}/></div><p className="muted">Stufe: {SMARTNESS_LEVEL_LABELS[smartness.level] ?? smartness.level}. Der Wert misst Datengrundlage, Personalisierung, Prognosefähigkeit, Erklärbarkeit und Sicherheit getrennt.</p><div className="learning-stats">{smartness.dimensions.map((dimension) => <div key={dimension.key} title={dimension.evidence}><strong>{dimension.score}%</strong><span>{dimension.label}</span></div>)}</div><p><strong>Nächster Qualitätsschritt:</strong> {smartness.nextMilestone}</p></section>
    <section className="panel"><div className="panel-header"><div><p className="eyebrow">Freigabepflichtiger Agent</p><h2>Vorgeschlagene nächste Schritte</h2></div><span className="pill">Datenqualität: {DATA_QUALITY_LABELS[plan.dataQuality] ?? plan.dataQuality}</span></div><p className="muted">Der Agent analysiert und priorisiert nur. Er führt niemals Zahlungen oder Kontenänderungen ohne ausdrückliche Bestätigung aus.</p><div className="transaction-list">{plan.actions.map((action) => <div className="transaction-row" key={action.id}><div><strong>{action.title}</strong><span>{action.rationale}{action.amountCents ? ` · ${(action.amountCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''}</span></div><span className="pill">{ACTION_STATUS_LABELS[action.status] ?? action.status}</span>{action.status === 'proposed' && <div className="row-actions"><button aria-label="Vorschlag genehmigen" onClick={() => decide(action.id, 'approved')}><Check size={16}/></button><button aria-label="Vorschlag ablehnen" onClick={() => decide(action.id, 'rejected')}><X size={16}/></button></div>}</div>)}</div></section>
    <LearningBudgetPlanner />
  </div>
}
