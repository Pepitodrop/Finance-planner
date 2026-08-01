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
  type CostLevel,
  type SavingsStyle,
} from './budgetPlan'

function feedbackLabel(profile: BudgetProfile | null, recommendationId: string): string | null {
  const decision = profile?.feedbackSummary[recommendationId]?.lastDecision
  return decision === 'approved' ? 'Übernommen' : decision === 'rejected' ? 'Abgelehnt' : null
}

export function LearningBudgetPlanner() {
  const [learningConsent, setLearningConsent] = useState(false)
  const [externalConsent, setExternalConsent] = useState(false)
  const [locationConsent, setLocationConsent] = useState(false)
  const [country, setCountry] = useState('DE')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [costLevel, setCostLevel] = useState<CostLevel>('unknown')
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
        setLearningConsent(true)
        setSavingsStyle(stored.preferences.savingsStyle)
        setEmergencyMonths(stored.preferences.emergencyFundMonths)
        setSustainabilityPriority(stored.preferences.sustainabilityPriority)
        if (stored.location) {
          setCountry(stored.location.country)
          setRegion(stored.location.region || '')
          setCity(stored.location.city || '')
          setCostLevel(stored.location.costLevel)
          setLocationConsent(true)
        } else {
          setLocationConsent(false)
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Das Lernprofil konnte nicht geladen werden.')
      })
      .finally(() => {
        if (active) setProfileLoading(false)
      })
    return () => { active = false }
  }, [])

  const generatePlan = async () => {
    if (!learningConsent || loading) return
    const useExternalAi = externalConsent
    setExternalConsent(false)
    setLoading(true)
    setError('')
    try {
      const result = await requestLearningBudgetPlan({
        consentBehaviorLearning: true,
        consentExternalAi: useExternalAi,
        consentLocationContext: locationConsent,
        ...(locationConsent ? { location: { country, region: region.trim() || undefined, city: city.trim() || undefined, costLevel } } : {}),
        preferences: { savingsStyle, emergencyFundMonths: emergencyMonths, sustainabilityPriority },
      })
      setPlan(result)
      setProfile(result.learningProfile)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Budgetplan konnte nicht erstellt werden.')
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
      setError(reason instanceof Error ? reason.message : 'Die Rückmeldung konnte nicht gespeichert werden.')
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
      setError(reason instanceof Error ? reason.message : 'Das Lernprofil konnte nicht zurückgesetzt werden.')
    } finally {
      setLoading(false)
    }
  }

  return <section className="learning-budget" aria-labelledby="learning-budget-title">
    <article className="panel learning-budget-hero">
      <div>
        <p className="eyebrow">Persistentes Verhaltenslernen</p>
        <h2 id="learning-budget-title">Lernender Monatsbudgetplan</h2>
        <p>Der Plan verbindet synchronisierte Transaktionen, aktive Sparziele, wiederkehrende Kosten, bestätigte Entscheidungen und optional groben Standortkontext. Er lernt aus Zustimmung und Ablehnung, führt aber niemals Geldbewegungen aus.</p>
      </div>
      <div className="ai-model"><BrainCircuit size={18}/><div><strong>Deterministische Planung + optionale Qwen-Erklärung</strong><span>PostgreSQL-Lernprofil · Hugging Face nur nach Zustimmung</span></div></div>
    </article>

    <div className="learning-budget-grid">
      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Einstellungen</p><h2>Was darf gelernt werden?</h2></div><ShieldCheck size={20}/></div>
        <label className="checkbox"><input type="checkbox" checked={learningConsent} onChange={(event) => setLearningConsent(event.target.checked)} disabled={loading}/><span>Ich stimme zu, dass aus meiner verschlüsselten Finanzhistorie ein persönliches Lernprofil abgeleitet und verschlüsselt in PostgreSQL gespeichert wird.</span></label>
        <label className="checkbox"><input type="checkbox" checked={externalConsent} onChange={(event) => setExternalConsent(event.target.checked)} disabled={loading}/><span>Ich stimme für diesen Lauf zu, dass ausschließlich aggregierte Budgetwerte und das abgeleitete Profil an das konfigurierte Hugging-Face-Modell gesendet werden.</span></label>
        <label className="checkbox"><input type="checkbox" checked={locationConsent} onChange={(event) => setLocationConsent(event.target.checked)} disabled={loading}/><span>Groben Standortkontext für diesen Plan verwenden. Ohne Zustimmung wird kein Standortwert berechnet oder an Hugging Face übertragen.</span></label>

        {locationConsent && <div className="learning-budget-location">
          <label>Land<input value={country} maxLength={2} onChange={(event) => setCountry(event.target.value.toUpperCase())}/></label>
          <label>Region<input value={region} maxLength={100} onChange={(event) => setRegion(event.target.value)} placeholder="z. B. Baden-Württemberg"/></label>
          <label>Stadt<input value={city} maxLength={100} onChange={(event) => setCity(event.target.value)} placeholder="z. B. Karlsruhe"/></label>
          <label>Kostenniveau<select value={costLevel} onChange={(event) => setCostLevel(event.target.value as CostLevel)}><option value="unknown">Nicht festlegen</option><option value="low">Eher niedrig</option><option value="medium">Mittel</option><option value="high">Eher hoch</option></select></label>
        </div>}

        <div className="learning-budget-location">
          <label>Sparstil<select value={savingsStyle} onChange={(event) => setSavingsStyle(event.target.value as SavingsStyle)}><option value="conservative">Vorsichtig</option><option value="balanced">Ausgewogen</option><option value="ambitious">Ambitioniert</option></select></label>
          <label>Notgroschen in Monaten<input type="number" min="1" max="12" value={emergencyMonths} onChange={(event) => setEmergencyMonths(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}/></label>
          <label>Nachhaltigkeitspriorität: {sustainabilityPriority}%<input type="range" min="0" max="100" step="5" value={sustainabilityPriority} onChange={(event) => setSustainabilityPriority(Number(event.target.value))}/></label>
        </div>

        <button className="primary receipt-analyze" type="button" disabled={!learningConsent || loading || profileLoading} onClick={() => void generatePlan()}>{loading ? <LoaderCircle className="spin" size={18}/> : <Target size={18}/>} {loading ? 'Budgetplan wird erstellt …' : 'Persönlichen Budgetplan erstellen'}</button>
        {error && <p className="status-message error-message" role="alert"><AlertTriangle size={17}/>{error}</p>}
      </article>

      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Lernstatus</p><h2>Persistentes Profil</h2></div>{profile ? <CircleCheck size={20}/> : <MapPin size={20}/>}</div>
        {profileLoading && <p className="status-message" role="status"><LoaderCircle className="spin" size={17}/> Lernprofil wird geladen …</p>}
        {!profileLoading && !profile && <div className="receipt-empty"><BrainCircuit size={38}/><strong>Noch kein serverseitiges Lernprofil</strong><span>Nach dem ersten Plan werden nur abgeleitete Muster, Einstellungen und Rückmeldungen verschlüsselt gespeichert.</span></div>}
        {profile && <>
          <div className="learning-stats"><div><strong>{Math.round(profile.confidence * 100)}%</strong><span>Konfidenz</span></div><div><strong>{profile.learnedFromTransactions}</strong><span>Transaktionen</span></div><div><strong>{profile.patterns.goalCount}</strong><span>Aktive Sparziele</span></div></div>
          <p className="muted">Letztes Lernen: {new Date(profile.lastLearnedAt).toLocaleString('de-DE')}. Rohbeschreibungen und präzise Koordinaten werden nicht im Lernprofil gespeichert.</p>
          <button className="secondary" type="button" onClick={() => void resetProfile()} disabled={loading}><RotateCcw size={16}/> Lernprofil zurücksetzen</button>
        </>}
      </article>
    </div>

    {plan && <>
      <article className="panel">
        <div className="panel-header"><div><p className="eyebrow">Monatsplan</p><h2>Dein Budgetvorschlag</h2></div><span className="pill">Datenqualität: {plan.dataQuality.level === 'high' ? 'hoch' : plan.dataQuality.level === 'medium' ? 'mittel' : 'niedrig'}</span></div>
        <p>{plan.summary}</p>
        {plan.cashflowStatus === 'deficit' && <p className="status-message error-message" role="status"><AlertTriangle size={17}/><span>Monatliches Defizit: {formatMoney(plan.monthlyDeficitCents)}. Sparziel- und Notgroschenbeiträge werden nicht aus nicht vorhandenem Einkommen erzeugt.</span></p>}
        <div className="learning-budget-allocations">
          <div><span>Einnahmen</span><strong>{formatMoney(plan.allocations.incomeCents)}</strong></div>
          <div><span>Grundbedarf</span><strong>{formatMoney(plan.allocations.essentialCents)}</strong></div>
          <div><span>Flexibel</span><strong>{formatMoney(plan.allocations.flexibleCents)}</strong></div>
          <div><span>Notgroschen</span><strong>{formatMoney(plan.allocations.emergencyFundCents)}</strong></div>
          <div><span>Aktive Sparziele</span><strong>{formatMoney(plan.allocations.savingsGoalsCents)}</strong></div>
        </div>
        <p className="muted">Liquider Notgroschen: {formatMoney(plan.emergencyFund.currentBalanceCents)} von {formatMoney(plan.emergencyFund.targetCents)} Zielwert · verbleibende Lücke {formatMoney(plan.emergencyFund.gapCents)}.</p>
        <p className="muted">Quelle: {plan.ai.source === 'hugging-face-budget-explanation' ? `${plan.ai.model?.id} über Hugging Face` : 'deterministische Budget-Engine'}. Modelltexte dürfen die berechneten Beträge nicht verändern.</p>
      </article>

      {plan.categoryCaps.length > 0 && <article className="panel"><div className="panel-header"><div><p className="eyebrow">Kategorien</p><h2>Monatliche Richtwerte</h2></div><Target size={20}/></div><div className="transaction-list">{plan.categoryCaps.map((category) => <div className="transaction-row" key={category.category}><div><strong>{category.category}</strong><span>{category.rationale} · bisher {formatMoney(category.historicalMonthlyCents)}</span></div><b>{formatMoney(category.recommendedCapCents)}</b></div>)}</div></article>}

      {plan.goalAllocations.length > 0 && <article className="panel"><div className="panel-header"><div><p className="eyebrow">Sparpläne</p><h2>Empfohlene monatliche Verteilung</h2></div><Target size={20}/></div><div className="transaction-list">{plan.goalAllocations.map((goal) => <div className="transaction-row" key={goal.goalId}><div><strong>{goal.name}</strong><span>Benötigt {formatMoney(goal.requiredMonthlyCents)} · Ziel {new Date(goal.targetDate).toLocaleDateString('de-DE')}</span></div><b>{formatMoney(goal.recommendedMonthlyCents)}</b><span className="pill">{goal.onTrack ? 'im Plan' : 'Ziel gefährdet'}</span></div>)}</div></article>}

      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Feedback-Schleife</p><h2>Empfehlungen bestätigen oder ablehnen</h2></div><Leaf size={20}/></div><div className="transaction-list">{plan.recommendations.map((recommendation) => {
        const learnedDecision = feedbackLabel(profile, recommendation.id)
        return <div className="transaction-row learning-budget-recommendation" key={recommendation.id}><div><strong>{recommendation.title}</strong><span>{recommendation.aiExplanation || recommendation.explanation}</span></div>{learnedDecision && <span className="pill">{learnedDecision}</span>}<div className="row-actions"><button aria-label={`${recommendation.title} übernehmen`} disabled={!learningConsent || feedbackLoading === recommendation.id} onClick={() => void decide(recommendation.id, 'approved')}>{feedbackLoading === recommendation.id ? <LoaderCircle className="spin" size={16}/> : <Check size={16}/>}</button><button aria-label={`${recommendation.title} ablehnen`} disabled={!learningConsent || feedbackLoading === recommendation.id} onClick={() => void decide(recommendation.id, 'rejected')}><X size={16}/></button></div></div>
      })}</div></article>

      <article className="panel"><div className="panel-header"><div><p className="eyebrow">Transparenz</p><h2>Grenzen und Datenschutz</h2></div><ShieldCheck size={20}/></div><ul className="receipt-limitations">{plan.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></article>
    </>}
  </section>
}
