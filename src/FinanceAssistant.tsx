import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChartNoAxesCombined, Check, ChevronDown, CircleCheck, Gauge, HardDrive, Info, LoaderCircle, MessageCircleQuestion, Route, Send, Server, ShieldCheck, X } from 'lucide-react'
import { FALLBACK_LOCAL_ASSISTANT_MODEL, HOSTED_ASSISTANT_MODEL, HostedAiFallbackError, PRIMARY_LOCAL_ASSISTANT_MODEL, runAssistant, runDeterministicAssistant, type AssistantEngine, type AssistantMode } from './assistant'
import { behaviorSummary } from './behavior'
import { createFinancialAgentPlan, decideAgentAction, type AgentPlan } from './financialAgent'
import { ACTION_STATUS_LABELS, DATA_QUALITY_LABELS, SMARTNESS_LEVEL_LABELS } from './financeLabels'
import { IntelligenceBadge, type IntelligenceKind } from './IntelligenceBadge'
import { LearningBudgetPlanner } from './LearningBudgetPlanner'
import { createSmartBriefing } from './smartBriefing'
import { assessSmartness } from './smartness'
import type { AppState } from './types'

type AnswerSource = 'hosted' | 'local' | 'server-fallback' | 'client-fallback'
export type AssistantAcceptanceMode = 'hosted-consent' | 'hosted-running' | 'success' | 'hosted-fallback' | 'local-selected' | 'local-running'

const WHAT_IS_SENT = [
  'Income, expenses, free cash, recurring-expense total, account balance, transaction count, months covered',
  'Category totals by rank only (no category names)',
  'Goal amounts remaining and target dates only (no goal names)',
  'Your typed question (up to 500 characters)',
]

export function FinanceAssistant({ state, budgetAcceptanceMode, acceptanceMode }: { state: AppState; budgetAcceptanceMode?: 'consent' | 'result'; acceptanceMode?: AssistantAcceptanceMode }) {
  const [mode, setMode] = useState<AssistantMode>('analysis')
  const [engine, setEngine] = useState<AssistantEngine>(acceptanceMode === 'local-selected' || acceptanceMode === 'local-running' ? 'local' : 'hosted')
  const [consentExternalAi, setConsentExternalAi] = useState(false)
  const [localAcknowledged, setLocalAcknowledged] = useState(false)
  const [showConsentDetail, setShowConsentDetail] = useState(false)
  const [question, setQuestion] = useState('How can I reach my savings goals faster?')
  const [answer, setAnswer] = useState(() => {
    if (acceptanceMode === 'success') return 'Personal financial analysis\n\nYour recorded net cash flow is positive and recurring expenses stay within a sustainable share of income.\n\nConfidence: 82%.'
    if (acceptanceMode === 'hosted-fallback') return 'Rule-based analysis available; the language model could not be used safely.\n\nNote: The hosted models could not produce a verifiable answer this time. This rule-based substitute analysis comes from the Finance Planner server, and you can ask again.'
    return ''
  })
  const [answerSource, setAnswerSource] = useState<AnswerSource | null>(() => acceptanceMode === 'success' ? 'hosted' : acceptanceMode === 'hosted-fallback' ? 'server-fallback' : null)
  const [loading, setLoading] = useState(acceptanceMode === 'hosted-running' || acceptanceMode === 'local-running')
  const [error, setError] = useState(acceptanceMode === 'hosted-fallback' ? 'The hosted models did not return a verifiable answer.' : '')
  const answerRef = useRef<HTMLElement | null>(null)
  const initialPlan = useMemo(() => createFinancialAgentPlan(state), [state])
  const [plan, setPlan] = useState<AgentPlan>(initialPlan)
  const learned = behaviorSummary()
  const smartness = useMemo(() => assessSmartness(state, learned.learnedDecisions), [state, learned.learnedDecisions])
  const briefing = useMemo(() => createSmartBriefing(state), [state])

  const run = async () => {
    const gated = engine === 'hosted' ? !consentExternalAi : !localAcknowledged
    if (!question.trim() || loading || gated) return
    setLoading(true); setError(''); setAnswer(''); setAnswerSource(null)
    requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    try {
      const result = await runAssistant(mode, state, question.trim(), engine, consentExternalAi)
      setAnswer(result)
      setAnswerSource(engine)
      setPlan(createFinancialAgentPlan(state))
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'The analysis could not be created.'
      const fallback = reason instanceof HostedAiFallbackError
        ? reason.fallbackAnswer
        : runDeterministicAssistant(mode, state, question.trim())
      const fallbackNote = reason instanceof HostedAiFallbackError
        ? 'Note: The hosted models could not produce a verifiable answer this time. This rule-based substitute analysis comes from the Finance Planner server, and you can ask again.'
        : 'Note: The AI request failed. The substitute analysis above was built only from your locally calculated financial figures.'
      setError(message)
      setAnswer(`${fallback}\n\n${fallbackNote}`)
      setAnswerSource(reason instanceof HostedAiFallbackError ? 'server-fallback' : 'client-fallback')
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } finally { setLoading(false) }
  }

  const decide = (actionId: string, decision: 'approved' | 'rejected') => setPlan((current) => decideAgentAction(current, actionId, decision))
  const activeModel = engine === 'hosted' ? HOSTED_ASSISTANT_MODEL : `${PRIMARY_LOCAL_ASSISTANT_MODEL} (fallback: ${FALLBACK_LOCAL_ASSISTANT_MODEL})`
  const hostedConsentMissing = engine === 'hosted' && !consentExternalAi
  const localAckMissing = engine === 'local' && !localAcknowledged
  const runDisabled = loading || !question.trim() || hostedConsentMissing || localAckMissing
  const answerBadge: { kind: IntelligenceKind; label?: string } | null = answerSource === 'hosted'
    ? { kind: 'hosted' }
    : answerSource === 'local'
      ? { kind: 'local' }
      : answerSource === 'server-fallback'
        ? { kind: 'calculated', label: 'Calculated · server fallback' }
        : answerSource === 'client-fallback'
          ? { kind: 'calculated', label: 'Calculated · local fallback' }
          : null

  return <div className="assistant-page" lang="en" data-assistant-ready="true">
    <section className="panel assistant-hero">
      <div><p className="eyebrow">Choose how this runs</p><h2>Analysis, questions, and financial planning</h2><p>Hosted models run through the Finance Planner server and require your consent each session. On-device models stay on your device and are only loaded after you explicitly select them.</p></div>
      <div className="ai-model"><IntelligenceBadge kind={engine === 'hosted' ? 'hosted' : 'local'}/><div><strong>{activeModel}</strong><span>{engine === 'hosted' ? 'Server-side analyst + critic ensemble' : 'Runs locally in your browser · large one-time model download'}</span></div></div>
    </section>

    {briefing.length > 0 && <section className="panel smart-briefing" aria-labelledby="smart-briefing-title"><div className="panel-header"><div><p className="eyebrow">Automatically prioritized</p><h2 id="smart-briefing-title">Today's briefing</h2></div><IntelligenceBadge kind="calculated"/></div><div className="smart-briefing-list">{briefing.map((item) => <article className={`smart-briefing-item ${item.severity}`} key={item.id}>{item.severity === 'attention' ? <AlertTriangle size={19}/> : item.severity === 'positive' ? <CircleCheck size={19}/> : <Info size={19}/>}<div><strong>{item.title}</strong><p>{item.detail}</p></div></article>)}</div></section>}

    <section className="panel assistant-controls">
      <div className="assistant-modes" role="tablist" aria-label="Assistant mode"><button role="tab" aria-selected={mode === 'analysis'} className={mode === 'analysis' ? 'active' : ''} onClick={() => setMode('analysis')}><ChartNoAxesCombined size={17}/> Analysis</button><button role="tab" aria-selected={mode === 'question'} className={mode === 'question' ? 'active' : ''} onClick={() => setMode('question')}><MessageCircleQuestion size={17}/> Questions</button><button role="tab" aria-selected={mode === 'planning'} className={mode === 'planning' ? 'active' : ''} onClick={() => setMode('planning')}><Route size={17}/> Planning</button></div>

      <div className="assistant-engine" role="radiogroup" aria-label="Choose how the assistant runs">
        <button type="button" role="radio" aria-checked={engine === 'hosted'} className={`assistant-engine-card ${engine === 'hosted' ? 'active' : ''}`} onClick={() => { setEngine('hosted'); setError('') }} disabled={loading}>
          <Server size={18}/><div><strong>Hosted model</strong><span>Qwen3 4B analyst + critic, via the Finance Planner server — only with your consent, only for this session.</span></div>
        </button>
        <button type="button" role="radio" aria-checked={engine === 'local'} className={`assistant-engine-card ${engine === 'local' ? 'active' : ''}`} onClick={() => { setEngine('local'); setError('') }} disabled={loading}>
          <HardDrive size={18}/><div><strong>On-device model</strong><span>Runs fully in your browser — larger first-time download, no server involved.</span></div>
        </button>
      </div>

      {engine === 'hosted' && <div className="assistant-consent">
        <label className="checkbox"><input type="checkbox" checked={consentExternalAi} onChange={(event) => setConsentExternalAi(event.target.checked)} disabled={loading}/><span>I agree that for this session, only aggregated financial totals and my question are sent through the Finance Planner server to the configured model. Transaction descriptions, account names, category names, and goal names are not sent.</span></label>
        <button type="button" className="assistant-consent-toggle" onClick={() => setShowConsentDetail((current) => !current)} aria-expanded={showConsentDetail}>What's included <ChevronDown size={14} style={{ transform: showConsentDetail ? 'rotate(180deg)' : undefined }}/></button>
        {showConsentDetail && <ul className="assistant-consent-detail">{WHAT_IS_SENT.map((item) => <li key={item}>{item}</li>)}</ul>}
      </div>}

      {engine === 'local' && <div className="assistant-local-warning">
        <p className="status-message" role="note"><Info size={18}/><span>The on-device model isn't downloaded yet. The first run may download several hundred megabytes and use noticeably more of your device's memory and battery than the hosted option. It stays cached in your browser after that.</span></p>
        <label className="checkbox"><input type="checkbox" checked={localAcknowledged} onChange={(event) => setLocalAcknowledged(event.target.checked)} disabled={loading}/><span>I understand this will download data to my device.</span></label>
      </div>}

      <label>Your question or goal<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={5}/></label>
      <button className="primary" onClick={() => void run()} disabled={runDisabled}>{loading ? <LoaderCircle className="spin" size={18}/> : <Send size={18}/>} {loading ? (engine === 'local' ? 'On-device model working…' : 'Analysis running…') : hostedConsentMissing ? 'Consent required' : localAckMissing ? 'Confirmation required' : 'Start assistant'}</button>
      {loading && <div className="status-message" role="status" aria-live="polite"><LoaderCircle className="spin" size={18}/><div><strong>{engine === 'local' ? 'On-device model loading and running' : 'Building your financial analysis'}</strong><span>{engine === 'local' ? 'Model files load on the first run. Later runs can use the browser cache.' : 'Data is being aggregated, models consulted, and the answer prepared. This can take up to a minute.'}</span></div></div>}
    </section>

    <section ref={answerRef} className="panel assistant-answer" aria-live="polite">
      <div className="panel-header"><div><p className="eyebrow">{loading ? 'In progress' : answer ? (error ? 'Rule-based substitute analysis' : 'Analysis complete') : 'Result'}</p><h2>Assistant answer</h2></div>{answerBadge && <IntelligenceBadge kind={answerBadge.kind} label={answerBadge.label}/>}</div>
      {error && <div className="status-message error-message" role="alert"><X size={18}/><div><strong>AI request unsuccessful</strong><span>{error}</span><button className="secondary" onClick={() => void run()} disabled={hostedConsentMissing || localAckMissing}>Try again</button></div></div>}
      <div className="answer-text">{loading ? 'The answer will appear here automatically once the analysis is complete.' : answer || 'Start an analysis, ask a question, or request a financial plan.'}</div>
    </section>

    <section className="panel assistant-agent">
      <div className="panel-header"><div><p className="eyebrow">Suggested actions</p><h2>Proposed next steps</h2></div><span className="pill">Data quality: {DATA_QUALITY_LABELS[plan.dataQuality] ?? plan.dataQuality}</span></div>
      <p className="muted">The assistant only analyzes and prioritizes. It never makes payments or account changes without your explicit approval — and approval here only records your decision, it doesn't move money.</p>
      <div className="transaction-list">{plan.actions.map((action) => <div className="transaction-row assistant-agent-row" key={action.id}>
        <div><strong>{action.title}</strong><span>{action.rationale}{action.amountCents ? ` · ${(action.amountCents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}` : ''}</span></div>
        <IntelligenceBadge kind="calculated" label="Calculated · requires approval"/>
        <span className="pill">{ACTION_STATUS_LABELS[action.status] ?? action.status}</span>
        {action.status === 'proposed' && <div className="row-actions"><button aria-label={`Approve ${action.title}`} onClick={() => decide(action.id, 'approved')}><Check size={16}/></button><button aria-label={`Reject ${action.title}`} onClick={() => decide(action.id, 'rejected')}><X size={16}/></button></div>}
      </div>)}</div>
    </section>

    <section className="assistant-grid">
      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Behavior learning</p><h2>Personal pattern graph</h2></div><IntelligenceBadge kind="calculated"/></div><div className="learning-stats"><div><strong>{learned.nodes}</strong><span>Nodes</span></div><div><strong>{learned.edges}</strong><span>Links</span></div><div><strong>{learned.learnedDecisions}</strong><span>Confirmations</span></div></div><p className="muted">Learned from your own confirmed categorizations only — not a trained model. Every applied merchant, category, and recurrence decision strengthens local pattern links.</p></article>
      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Measurable readiness</p><h2>Assistant readiness: {smartness.overall}%</h2></div><Gauge size={20}/></div><p className="muted assistant-smartness-caption">A readiness score based on how much data and confirmed history exist — not a measure of how accurate any single answer is. Level: {SMARTNESS_LEVEL_LABELS[smartness.level] ?? smartness.level}.</p><div className="learning-stats">{smartness.dimensions.map((dimension) => <div key={dimension.key} title={dimension.evidence}><strong>{dimension.score}%</strong><span>{dimension.label}</span></div>)}</div><p><strong>Next milestone:</strong> {smartness.nextMilestone}</p></article>
    </section>

    <div className="assistant-budget-divider"><ShieldCheck size={16}/><span>Learning budget plan</span></div>
    <LearningBudgetPlanner acceptanceMode={budgetAcceptanceMode}/>
  </div>
}
