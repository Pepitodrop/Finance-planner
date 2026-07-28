const REVIEWED_MODEL_REVISIONS = Object.freeze({
  analyst: new Map([
    ['Qwen/Qwen3-4B-Thinking-2507:fastest', '768f209d9ea81521153ed38c47d515654e938aea'],
  ]),
  critic: new Map([
    ['Qwen/Qwen3-4B-Instruct-2507:fastest', '1b4199c4f36b0cef378bfb12390c18780c18af4c'],
  ]),
})

function reviewedModel(role, modelValue, revisionValue) {
  const model = String(modelValue || '')
  const revision = String(revisionValue || '')
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error(`${role} revision must be an immutable 40-character Hugging Face revision`)
  const reviewedRevision = REVIEWED_MODEL_REVISIONS[role]?.get(model)
  if (!reviewedRevision) throw new Error(`${role} model is not in the reviewed model-and-revision allowlist`)
  if (revision !== reviewedRevision) throw new Error(`${role} model revision does not match the reviewed production lock`)
  return { model, revision }
}

export function governedAiModels(env, defaults) {
  const analyst = reviewedModel('analyst', env.HF_MODEL || defaults.model, env.HF_MODEL_REVISION || defaults.revision)
  const criticEnabled = env.HF_CRITIC_ENABLED === 'true'
  if (!criticEnabled) return { analyst, critic: null }
  const critic = reviewedModel(
    'critic',
    env.HF_CRITIC_MODEL || 'Qwen/Qwen3-4B-Instruct-2507:fastest',
    env.HF_CRITIC_MODEL_REVISION || '1b4199c4f36b0cef378bfb12390c18780c18af4c',
  )
  return { analyst, critic }
}

export async function runGovernedEnsemble({ transport, models, snapshot, analystPrompt, parseAndValidate }) {
  const analystContent = await transport.chatCompletion({
    model: models.analyst.model,
    revision: models.analyst.revision,
    temperature: 0.1,
    maxTokens: 900,
    messages: analystPrompt(snapshot),
  })
  const analyst = parseAndValidate(analystContent)
  if (!models.critic) return { result: analyst, modelsUsed: [models.analyst], agreement: null }

  const criticContent = await transport.chatCompletion({
    model: models.critic.model,
    revision: models.critic.revision,
    temperature: 0,
    maxTokens: 900,
    messages: [
      { role: 'system', content: 'Du bist ein unabhängiger, konservativer Prüfer für Finanzhinweise. Prüfe ausschließlich gegen den aggregierten Snapshot. Entferne ungestützte Aussagen, senke überhöhte Konfidenz und antworte ausschließlich im identischen JSON-Schema summary, confidence, signals. Führe keine Finanzaktion aus.' },
      { role: 'user', content: JSON.stringify({ snapshot, candidate: analyst }) },
    ],
  })
  const critic = parseAndValidate(criticContent)
  const analystKeys = new Set(analyst.signals.map((signal) => `${signal.type}:${signal.severity}`))
  const agreedSignals = critic.signals.filter((signal) => analystKeys.has(`${signal.type}:${signal.severity}`))
  const agreement = analyst.signals.length === 0 ? (critic.signals.length === 0 ? 1 : 0) : agreedSignals.length / analyst.signals.length
  return {
    result: { ...critic, confidence: Math.min(critic.confidence, analyst.confidence, 0.95), signals: agreedSignals },
    modelsUsed: [models.analyst, models.critic],
    agreement: Number(agreement.toFixed(2)),
  }
}

const round = (value, digits = 3) => Number(value.toFixed(digits))
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function monthsUntil(targetDate, now = new Date()) {
  const target = new Date(`${targetDate}T00:00:00Z`)
  if (Number.isNaN(target.getTime())) return null
  const months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + target.getUTCMonth() - now.getUTCMonth()
  return Math.max(0, months)
}

function goalFeasibility(goals, freeCashCents) {
  return (goals || []).map((goal, index) => {
    const monthsRemaining = monthsUntil(goal.targetDate)
    const requiredMonthlyCents = monthsRemaining === null ? null : (monthsRemaining === 0 ? goal.remainingCents : Math.ceil(goal.remainingCents / monthsRemaining))
    const coverageRatio = requiredMonthlyCents === null || requiredMonthlyCents === 0 ? 1 : freeCashCents / requiredMonthlyCents
    const status = coverageRatio >= 1.2 ? 'on-track' : coverageRatio >= 0.8 ? 'at-risk' : 'off-track'
    return {
      goalIndex: index,
      targetDate: goal.targetDate,
      remainingCents: goal.remainingCents,
      monthsRemaining,
      requiredMonthlyCents,
      coverageRatio: round(coverageRatio),
      status,
    }
  })
}

function healthScore({ savingsRate, recurringShare, runwayMonths, goalResults }) {
  const savingsComponent = clamp(savingsRate / 0.2, 0, 1) * 35
  const recurringComponent = (1 - clamp(recurringShare / 0.8, 0, 1)) * 20
  const runwayComponent = runwayMonths === null ? 10 : clamp(runwayMonths / 6, 0, 1) * 30
  const goalComponent = goalResults.length === 0 ? 15 : goalResults.reduce((sum, goal) => sum + ({ 'on-track': 1, 'at-risk': 0.55, 'off-track': 0.1 }[goal.status]), 0) / goalResults.length * 15
  return Math.round(clamp(savingsComponent + recurringComponent + runwayComponent + goalComponent, 0, 100))
}

function stressScenarios(snapshot, monthlyBurn) {
  const balance = snapshot.accountBalanceCents
  const freeCash = snapshot.freeCashCents
  const scenarios = [
    { code: 'income_drop_20', adjustedFreeCashCents: freeCash - Math.round(snapshot.incomeCents * 0.2) },
    { code: 'expense_spike_15', adjustedFreeCashCents: freeCash - Math.round(snapshot.expenseCents * 0.15) },
    { code: 'combined_stress', adjustedFreeCashCents: freeCash - Math.round(snapshot.incomeCents * 0.2) - Math.round(snapshot.expenseCents * 0.15) },
  ]
  return scenarios.map((scenario) => ({
    ...scenario,
    monthlyDeficitCents: Math.max(0, -scenario.adjustedFreeCashCents),
    stressedRunwayMonths: monthlyBurn > 0 ? round(balance / (monthlyBurn + Math.max(0, -scenario.adjustedFreeCashCents)), 2) : null,
    severity: scenario.adjustedFreeCashCents < 0 ? 'warning' : 'info',
  }))
}

export function deterministicScenarioInsights(snapshot) {
  const savingsRate = snapshot.incomeCents > 0 ? snapshot.freeCashCents / snapshot.incomeCents : 0
  const recurringShare = snapshot.expenseCents > 0 ? snapshot.recurringExpenseCents / snapshot.expenseCents : 0
  const monthlyBurn = snapshot.monthsCovered > 0 ? snapshot.expenseCents / snapshot.monthsCovered : snapshot.expenseCents
  const runwayMonths = monthlyBurn > 0 ? snapshot.accountBalanceCents / monthlyBurn : null
  const goals = goalFeasibility(snapshot.goals || [], snapshot.freeCashCents)
  const score = healthScore({ savingsRate, recurringShare, runwayMonths, goalResults: goals })
  const insights = []

  if (savingsRate < 0.1) insights.push({ code: 'low_savings_rate', value: round(savingsRate), severity: savingsRate <= 0 ? 'critical' : 'warning', priority: savingsRate <= 0 ? 100 : 80 })
  if (recurringShare > 0.6) insights.push({ code: 'high_recurring_share', value: round(recurringShare), severity: 'warning', priority: 70 })
  if (runwayMonths !== null && runwayMonths < 3) insights.push({ code: 'low_liquidity_runway', value: round(runwayMonths, 2), severity: runwayMonths < 1 ? 'critical' : 'warning', priority: runwayMonths < 1 ? 95 : 75 })
  for (const goal of goals) {
    if (goal.status !== 'on-track') insights.push({ code: 'goal_feasibility_risk', goalIndex: goal.goalIndex, value: goal.coverageRatio, severity: goal.status === 'off-track' ? 'critical' : 'warning', priority: goal.status === 'off-track' ? 90 : 65 })
  }
  insights.sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code))

  return {
    savingsRate: round(savingsRate),
    recurringShare: round(recurringShare),
    runwayMonths: runwayMonths === null ? null : round(runwayMonths, 2),
    healthScore: score,
    healthBand: score >= 80 ? 'strong' : score >= 60 ? 'stable' : score >= 40 ? 'fragile' : 'critical',
    goals,
    stressScenarios: stressScenarios(snapshot, monthlyBurn),
    insights,
    methodologyVersion: '2.0.0',
  }
}
