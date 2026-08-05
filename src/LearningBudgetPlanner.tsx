import { useEffect, useState } from 'react'
import { AlertTriangle, BrainCircuit, Check, CircleCheck, Leaf, LoaderCircle, MapPin, RotateCcw, ShieldCheck, Target, X } from 'lucide-react'
import { formatMoney } from './finance'
import {
  loadLearningBudgetProfile,
  requestLearningBudgetPlan,
  resetLearningBudgetProfile,
  submitBudgetFeedback,
  type BudgetDecision,
  type BudgetPlan,
  type BudgetProfile,
  type SavingsStyle,
} from './budgetPlan'

function feedbackLabel(profile: BudgetProfile | null, recommendationId: string): string | null {
  const decision = profile?.feedbackSummary[recommendationId]?.lastDecision
  return decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : null
}

function locationLabel(location: BudgetProfile['location']): string {
  if (!location) return ''
  return [location.city, location.region, location.country].filter(Boolean).join(', ')
}

export function LearningBudgetPlanner() {
  const [learningConsent, setLearningConsent] = useState(false)
  const [externalConsent, setExternalConsent] = useState(false)
  const [locationConsent, setLocationConsent] = useState(false)
  const [savingsStyle, setSavingsStyle] = useState<SavingsStyle>('balanced')
  const [emergencyMonths, setEmergencyMonths] = useState(3)
  const [sustainabilityPriority, setSustainabilityPriority] = useState(60)
  const [profile, setProfile] = useState<BudgetProfile | null>(null)
  const [plan, setPlan] = useState<BudgetPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [profileLoading, setProfileLoading] = useState(true)
  const [feedbackLoading, setFeedbackLoading] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void loadLearningBudgetProfile()
      .then((stored) => {
        if (!active || !stored) return
        setProfile(stored)
        setSavingsStyle(stored.preferences.savingsStyle)
        setEmergencyMonths(stored.preferences.emergencyFundMonths)
        setSustainabilityPriority(stored.preferences.sustainabilityPriority)
        setLocationConsent(false)
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'The learning profile could not be loaded.')
      })
      .finally(() => {
        if (active) setProfileLoading(false)
      })
    return () => { active = false }
  }, [])

  const generatePlan = async () => {
    if (!learningConsent || loading) return
    const useExternalAi = externalConsent
    const useIpLocation = locationConsent
    setExternalConsent(false)
    setLocationConsent(false)
    setLoading(true)
    setError('')
    try {
      const result = await requestLearningBudgetPlan({
        consentBehaviorLearning: true,
        consentExternalAi: useExternalAi,
        consentLocationContext: useIpLocation,
        preferences: { savingsStyle, emergencyFundMonths: emergencyMonths, sustainabilityPriority },
      })
      setPlan(result)
      setProfile(result.learningProfile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The budget plan could not be created.')
    } finally {
      setLoading(false)
    }
  }

  const decide = async (recommendationId: string, decision: BudgetDecision) => {
    if (!plan || feedbackLoading || !learningConsent) return
    setFeedbackLoading(recommendationId)
    setError('')
    try {
      setProfile(await submitBudgetFeedback(plan.planId, recommendationId, decision))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The feedback could not be saved.')
    } finally {
      setFeedbackLoading('')
    }
  }

  const resetProfile = async () => {
    if (!profile || loading) return
    setLoading(true)
    setError('')
    try {
      await resetLearningBudgetProfile()
      setProfile(null)
      setPlan(null)
      setLearningConsent(false)
      setExternalConsent(false)
      setLocationConsent(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The learning profile could not be reset.')
    } finally {
      setLoading(false)
    }
  }

  return <section className="learning-budget" lang="en" data-feature="budget-planner" aria-labelledby="learning-budget-title">
    <article className="panel learning-budget-hero">
      <div>
        <p className="eyebrow">Deterministic planning</p>
        <h2 id="learning-budget-title">Learning budget plan</h2>
        <p>Finance Planner calculates the amounts from recorded finances. Optional AI can prioritize or explain only. This planner never executes payments or transfers.</p>
      </div>
      <div className="ai-model"><BrainCircuit size={18}/><div><strong>Deterministic amounts</strong><span>Optional external AI only with consent for this run</span></div></div>
    </article>

    <div className="learning-budget-grid">
      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Your consent</p><h2>Choose what to include</h2></div><ShieldCheck size={20}/></div>
        <label className="checkbox"><input type="checkbox" checked={learningConsent} onChange={(event) => setLearningConsent(event.target.checked)} disabled={loading}/><span><strong>Behavior learning.</strong> Save derived preferences and feedback for future plans.</span></label>
        <label className="checkbox"><input type="checkbox" checked={externalConsent} onChange={(event) => setExternalConsent(event.target.checked)} disabled={loading}/><span><strong>External AI for this run.</strong> Send only the allowed aggregated budget values for this run.</span></label>
        <label className="checkbox"><input type="checkbox" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} disabled={loading}/><span><strong>Approximate location for this run.</strong> Add broad cost context; precise location is not requested. This consent resets after the run.</span></label>

        <div className="learning-budget-location">
          <label>Savings style<select value={savingsStyle} onChange={(event) => setSavingsStyle(event.target.value as SavingsStyle)}><option value="conservative">Conservative</option><option value="balanced">Balanced</option><option value="ambitious">Ambitious</option></select></label>
          <label>Emergency-fund months<input type="number" min="1" max="12" value={emergencyMonths} onChange={(event) => setEmergencyMonths(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}/></label>
          <label>Sustainability priority: {sustainabilityPriority}%<input aria-label="Sustainability priority" type="range" min="0" max="100" step="5" value={sustainabilityPriority} onChange={(event) => setSustainabilityPriority(Number(event.target.value))}/></label>
        </div>

        <button className="primary receipt-analyze" type="button" disabled={!learningConsent || loading || profileLoading} onClick={() => void generatePlan()}>{loading ? <LoaderCircle className="spin" size={18}/> : <Target size={18}/>} {loading ? 'Creating budget plan…' : 'Create budget plan'}</button>
        {error && <p className="status-message error-message" role="alert"><AlertTriangle size={17}/>{error}</p>}
      </article>

      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Learning status</p><h2>Saved profile</h2></div>{profile ? <CircleCheck size={20}/> : <MapPin size={20}/>}</div>
        {profileLoading && <p className="status-message" role="status"><LoaderCircle className="spin" size={17}/> Loading learning profile…</p>}
        {!profileLoading && !profile && <div className="receipt-empty"><BrainCircuit size={38}/><strong>No saved learning profile</strong><span>After the first plan, only derived patterns, preferences and feedback are stored.</span></div>}
        {profile && <>
          <div className="learning-stats"><div><strong>{Math.round(profile.confidence * 100)}%</strong><span>Confidence</span></div><div><strong>{profile.learnedFromTransactions}</strong><span>Transactions</span></div><div><strong>{profile.patterns.goalCount}</strong><span>Active goals</span></div></div>
          <p className="muted">Last learned: {new Date(profile.lastLearnedAt).toLocaleString('en-GB')}. Raw descriptions, IP addresses and precise coordinates are not stored in the profile.</p>
          {profile.location && <p className="muted">Approximate context previously derived with consent: {locationLabel(profile.location)}. It is not reused automatically.</p>}
          <button className="secondary" type="button" onClick={() => void resetProfile()} disabled={loading}><RotateCcw size={16}/> Reset learning profile</button>
        </>}
      </article>
    </div>

    {plan && <>
      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Monthly plan</p><h2>Plan result</h2></div><span className="pill">Data quality: {plan.dataQuality.level}</span></div>
        <p>{plan.summary}</p>
        {plan.locationContext && <p className="status-message" role="status"><MapPin size={17}/><span>Approximate location context for this run: {locationLabel(plan.locationContext)}. This may be inaccurate.</span></p>}
        {plan.cashflowStatus === 'deficit' && <p className="status-message error-message" role="status"><AlertTriangle size={17}/><span>Monthly deficit: {formatMoney(plan.monthlyDeficitCents)}. Goal and emergency-fund allocations are not created from unavailable income.</span></p>}
        <div className="learning-budget-allocations">
          <div><span>Income</span><strong>{formatMoney(plan.allocations.incomeCents)}</strong></div>
          <div><span>Essentials</span><strong>{formatMoney(plan.allocations.essentialCents)}</strong></div>
          <div><span>Flexible</span><strong>{formatMoney(plan.allocations.flexibleCents)}</strong></div>
          <div><span>Emergency fund</span><strong>{formatMoney(plan.allocations.emergencyFundCents)}</strong></div>
          <div><span>Active goals</span><strong>{formatMoney(plan.allocations.savingsGoalsCents)}</strong></div>
        </div>
        <p className="muted">Emergency fund: {formatMoney(plan.emergencyFund.currentBalanceCents)} of {formatMoney(plan.emergencyFund.targetCents)} · remaining gap {formatMoney(plan.emergencyFund.gapCents)}.</p>
        <p className="muted">Amounts are deterministic. Optional AI provides explanation or prioritization only and does not change these values.</p>
      </article>

      {plan.categoryCaps.length > 0 && <article className="panel"><div className="panel-header"><div><p className="eyebrow">Kategorien</p><h2>Monatliche Richtwerte</h2></div><Target size={20}/></div><div className="transaction-list">{plan.categoryCaps.map((category) => <div className="transaction-row" key={category.category}><div><strong>{category.category}</strong><span>{category.rationale} · bisher {formatMoney(category.historicalMonthlyCents)}</span></div><b>{formatMoney(category.recommendedCapCents)}</b></div>)}</div></article>}

      {plan.goalAllocations.length > 0 && <article className="panel"><div className="panel-header"><div><p className="eyebrow">Sparpläne</p><h2>Empfohlene monatliche Verteilung</h2></div><Target size={20}/></div><div className="transaction-list">{plan.goalAllocations.map((goal) => <div className="transaction-row" key={goal.goalId}><div><strong>{goal.name}</strong><span>Benötigt {formatMoney(goal.requiredMonthlyCents)} · Ziel {new Date(goal.targetDate).toLocaleDateString('de-DE')}</span></div><b>{formatMoney(goal.recommendedMonthlyCents)}</b><span className="pill">{goal.onTrack ? 'im Plan' : 'Ziel gefährdet'}</span></div>)}</div></article>}

      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Feedback</p><h2>Review recommendations</h2></div><Leaf size={20}/></div><p className="muted">Approval records feedback. It does not move money.</p><div className="transaction-list">{plan.recommendations.map((recommendation) => {
        const learnedDecision = feedbackLabel(profile, recommendation.id)
        return <div className="transaction-row learning-budget-recommendation" key={recommendation.id}><div><strong>{recommendation.title}</strong><span>{recommendation.aiExplanation || recommendation.explanation}</span></div>{learnedDecision && <span className="pill">{learnedDecision}</span>}<div className="row-actions"><button aria-label={`Approve ${recommendation.title}`} disabled={!learningConsent || feedbackLoading === recommendation.id} onClick={() => void decide(recommendation.id, 'approved')}>{feedbackLoading === recommendation.id ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}</button><button aria-label={`Reject ${recommendation.title}`} disabled={!learningConsent || feedbackLoading === recommendation.id} onClick={() => void decide(recommendation.id, 'rejected')}><X size={16}/></button></div></div>
      })}</div></article>

      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Transparenz</p><h2>Grenzen und Datenschutz</h2></div><ShieldCheck size={20}/></div><ul className="receipt-limitations">{plan.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></article>
    </>}
  </section>
}
