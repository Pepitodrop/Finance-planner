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
  const analyst = reviewedModel(
    'analyst',
    env.HF_MODEL || defaults.model,
    env.HF_MODEL_REVISION || defaults.revision,
  )

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const round = (value, digits = 3) => Number(value.toFixed(digits))

function monthsUntil(targetDate, now = new Date()) {
  const target = new Date(`${targetDate}T00:00:00.000Z`)
  if (Number.isNaN(target.getTime())) return null
  const days = (target.getTime() - now.getTime()) / 86_400_000
  return Math.max(0, days / 30.4375)
}

function goalFeasibility(snapshot, monthlyFreeCashCents) {
  return snapshot.goals.map((goal, index) => {
    const monthsRemaining = monthsUntil(goal.targetDate)
    if (monthsRemaining === null || monthsRemaining <= 0) {
      return { rank: index + 1, targetDate: goal.targetDate, remainingCents: goal.remainingCents, status: goal.remainingCents === 0 ? 'completed' : 'overdue', confidence: 0.99 }
    }
    const requiredMonthlyCents = Math.ceil(goal.remainingCents / monthsRemaining)
    const coverageRatio = requiredMonthlyCents > 0 ? monthlyFreeCashCents / requiredMonthlyCents : 1
    const status = goal.remainingCents === 0 ? 'completed' : coverageRatio >= 1.15 ? 'on-track' : coverageRatio >= 0.85 ? 'tight' : 'at-risk'
    return {
      rank: index + 1,
      targetDate: goal.targetDate,
      remainingCents: goal.remainingCents,
      monthsRemaining: round(monthsRemaining, 1),
      requiredMonthlyCents,
      availableMonthlyFreeCashCents: monthlyFreeCashCents,
      coverageRatio: round(coverageRatio, 2),
      status,
      confidence: snapshot.monthsCovered >= 6 ? 0.92 : snapshot.monthsCovered >= 3 ? 0.8 : 0.62,
    }
  })
}

export function deterministicScenarioInsights(snapshot) {
  const historyMonths = Math.max(1, snapshot.monthsCovered || 1)
  const monthlyIncomeCents = Math.round(snapshot.incomeCents / historyMonths)
  const monthlyExpenseCents = Math.round(snapshot.expenseCents / historyMonths)
  const monthlyFreeCashCents = Math.round(snapshot.freeCashCents / historyMonths)
  const monthlyRecurringCents = Math.round(snapshot.recurringExpenseCents / historyMonths)
  const savingsRate = snapshot.incomeCents > 0 ? snapshot.freeCashCents / snapshot.incomeCents : 0
  const recurringShare = snapshot.expenseCents > 0 ? snapshot.recurringExpenseCents / snapshot.expenseCents : 0
  const runwayMonths = monthlyExpenseCents > 0 ? snapshot.accountBalanceCents / monthlyExpenseCents : null
  const fixedCostCoverage = monthlyRecurringCents > 0 ? monthlyIncomeCents / monthlyRecurringCents : null
  const dataConfidence = round(clamp((Math.min(snapshot.transactionCount / 60, 1) + Math.min(snapshot.monthsCovered / 6, 1)) / 2, 0, 1), 2)
  const goals = goalFeasibility(snapshot, Math.max(0, monthlyFreeCashCents))

  const insights = []
  const actions = []
  let riskPoints = 0

  if (savingsRate < 0.1) {
    const severity = savingsRate <= 0 ? 'critical' : 'warning'
    insights.push({ code: 'low_savings_rate', value: round(savingsRate), severity, confidence: dataConfidence })
    actions.push({ priority: severity === 'critical' ? 100 : 82, code: 'stabilize_cashflow', reason: 'Die Sparquote liegt unter 10 %.', requiresApproval: true })
    riskPoints += savingsRate <= 0 ? 35 : 20
  }
  if (recurringShare > 0.6) {
    insights.push({ code: 'high_recurring_share', value: round(recurringShare), severity: 'warning', confidence: dataConfidence })
    actions.push({ priority: 72, code: 'review_recurring_costs', reason: 'Mehr als 60 % der Ausgaben sind wiederkehrend.', requiresApproval: true })
    riskPoints += 15
  }
  if (runwayMonths !== null && runwayMonths < 3) {
    const severity = runwayMonths < 1 ? 'critical' : 'warning'
    insights.push({ code: 'low_liquidity_runway', value: round(runwayMonths, 2), severity, confidence: dataConfidence })
    actions.push({ priority: severity === 'critical' ? 95 : 78, code: 'build_liquidity_buffer', reason: 'Der verfügbare Liquiditätspuffer liegt unter drei Monatsausgaben.', requiresApproval: true })
    riskPoints += runwayMonths < 1 ? 30 : 18
  }
  const atRiskGoals = goals.filter((goal) => goal.status === 'at-risk' || goal.status === 'overdue')
  if (atRiskGoals.length > 0) {
    insights.push({ code: 'goal_capacity_gap', value: atRiskGoals.length, severity: 'warning', confidence: Math.min(dataConfidence, 0.92) })
    actions.push({ priority: 76, code: 'replan_goals', reason: `${atRiskGoals.length} Ziel(e) sind mit dem aktuellen freien Cashflow nicht ausreichend gedeckt.`, requiresApproval: true })
    riskPoints += Math.min(20, atRiskGoals.length * 8)
  }
  if (dataConfidence < 0.6) {
    insights.push({ code: 'limited_history', value: dataConfidence, severity: 'info', confidence: 0.99 })
    actions.push({ priority: 60, code: 'collect_more_history', reason: 'Mehr Transaktionen und längere Historie erhöhen die Prognosequalität.', requiresApproval: true })
    riskPoints += 8
  }

  const financialHealthScore = Math.round(clamp(100 - riskPoints, 0, 100))
  const decisionConfidence = round(clamp(0.55 + dataConfidence * 0.4, 0, 0.95), 2)
  actions.sort((a, b) => b.priority - a.priority)

  return {
    schemaVersion: 2,
    savingsRate: round(savingsRate),
    recurringShare: round(recurringShare),
    runwayMonths: runwayMonths === null ? null : round(runwayMonths, 2),
    fixedCostCoverage: fixedCostCoverage === null ? null : round(fixedCostCoverage, 2),
    monthlyIncomeCents,
    monthlyExpenseCents,
    monthlyFreeCashCents,
    financialHealthScore,
    riskLevel: financialHealthScore >= 80 ? 'low' : financialHealthScore >= 60 ? 'medium' : 'high',
    decisionConfidence,
    dataConfidence,
    goals,
    insights,
    prioritizedActions: actions.slice(0, 5),
    policy: 'Deterministic calculations only; recommendations are explainable, bounded by verified aggregates and always require user approval.',
  }
}
