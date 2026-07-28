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
const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

function insight(code, value, severity, priority, explanation, suggestedAction) {
  return { code, value, severity, priority, explanation, suggestedAction, requiresApproval: true }
}

export function deterministicScenarioInsights(inputSnapshot = {}) {
  const snapshot = inputSnapshot && typeof inputSnapshot === 'object' ? inputSnapshot : {}
  const income = Math.max(0, finiteNumber(snapshot.incomeCents))
  const expenses = Math.max(0, finiteNumber(snapshot.expenseCents))
  const freeCash = finiteNumber(snapshot.freeCashCents, income - expenses)
  const recurring = Math.max(0, finiteNumber(snapshot.recurringExpenseCents))
  const balance = Math.max(0, finiteNumber(snapshot.accountBalanceCents))
  const historyMonths = Math.max(0, finiteNumber(snapshot.monthsCovered))
  const transactionCount = Math.max(0, finiteNumber(snapshot.transactionCount))
  const goals = Array.isArray(snapshot.goals) ? snapshot.goals : []
  const savingsRate = income > 0 ? freeCash / income : 0
  const expenseRatio = income > 0 ? expenses / income : null
  const recurringShare = expenses > 0 ? recurring / expenses : 0
  const monthlyBurn = historyMonths > 0 ? expenses / historyMonths : expenses
  const monthlyRecurring = historyMonths > 0 ? recurring / historyMonths : recurring
  const monthlyFreeCash = historyMonths > 0 ? freeCash / historyMonths : freeCash
  const runwayMonths = monthlyBurn > 0 ? balance / monthlyBurn : null
  const recurringCoverageMonths = monthlyRecurring > 0 ? balance / monthlyRecurring : null
  const goalRemainingCents = goals.reduce((sum, goal) => sum + Math.max(0, finiteNumber(goal?.remainingCents)), 0)
  const monthsToFundGoals = monthlyFreeCash > 0 && goalRemainingCents > 0 ? goalRemainingCents / monthlyFreeCash : null

  const stressedIncome = income * 0.9
  const stressedExpenses = expenses * 1.1
  const stressedFreeCash = stressedIncome - stressedExpenses
  const incomeShockSurvivable = stressedFreeCash >= 0

  const historyConfidence = clamp((Math.min(transactionCount, 90) / 90 + Math.min(historyMonths, 12) / 12) / 2, 0, 1)
  const savingsScore = clamp((savingsRate + 0.05) / 0.3, 0, 1)
  const runwayScore = runwayMonths === null ? 0.5 : clamp(runwayMonths / 6, 0, 1)
  const recurringScore = clamp(1 - recurringShare, 0, 1)
  const shockScore = incomeShockSurvivable ? 1 : clamp(1 + stressedFreeCash / Math.max(income, 1), 0, 1)
  const resilienceScore = Math.round(100 * (0.3 * savingsScore + 0.3 * runwayScore + 0.15 * recurringScore + 0.15 * shockScore + 0.1 * historyConfidence))

  const insights = []
  if (income === 0 && expenses > 0) insights.push(insight('no_income_with_expenses', expenses, 'critical', 100, 'Ausgaben sind vorhanden, aber im Analysezeitraum wurden keine Einnahmen erfasst.', 'Einnahmen-Daten prüfen und bis zur Klärung keine neuen freiwilligen Verpflichtungen eingehen.'))
  if (savingsRate < 0.1) insights.push(insight('low_savings_rate', round(savingsRate), savingsRate <= 0 ? 'critical' : 'warning', savingsRate <= 0 ? 95 : 75, 'Die freie Liquidität liegt unter 10 % der Einnahmen.', 'Variable Ausgaben und Sparziele prüfen; Änderungen erst nach Bestätigung übernehmen.'))
  if (recurringShare > 0.6) insights.push(insight('high_recurring_share', round(recurringShare), 'warning', 70, 'Mehr als 60 % der Ausgaben sind wiederkehrend und kurzfristig schwer anpassbar.', 'Wiederkehrende Verträge einzeln prüfen.'))
  if (runwayMonths !== null && runwayMonths < 3) insights.push(insight('low_liquidity_runway', round(runwayMonths, 2), runwayMonths < 1 ? 'critical' : 'warning', runwayMonths < 1 ? 98 : 85, 'Der verfügbare Kontostand deckt weniger als drei durchschnittliche Ausgabenmonate.', 'Liquiditätspuffer priorisieren und größere neue Ausgaben zurückstellen.'))
  if (!incomeShockSurvivable) insights.push(insight('stress_test_negative', Math.round(stressedFreeCash), 'warning', 88, 'Bei 10 % weniger Einnahmen und 10 % höheren Ausgaben würde der Cashflow negativ.', 'Einen Puffer für Einkommens- und Ausgabenschwankungen aufbauen.'))
  if (goalRemainingCents > 0 && monthlyFreeCash <= 0) insights.push(insight('goals_unfunded', goalRemainingCents, 'critical', 92, 'Aktuelle Ziele können aus dem derzeitigen freien Cashflow nicht finanziert werden.', 'Zieltermine oder Zielbeträge prüfen, ohne automatische Änderungen vorzunehmen.'))
  if (monthsToFundGoals !== null && monthsToFundGoals > 36) insights.push(insight('goals_slow_progress', round(monthsToFundGoals, 1), 'warning', 65, 'Bei unverändertem freien Cashflow benötigen die erfassten Ziele mehr als 36 Monate.', 'Zielprioritäten und monatliche Zuweisung prüfen.'))
  if (transactionCount < 15 || historyMonths < 3) insights.push(insight('insufficient_history', round(historyConfidence), 'info', 60, 'Die Datenhistorie ist für belastbare Prognosen noch begrenzt.', 'Mehr Historie sammeln und Prognosen bis dahin vorsichtig behandeln.'))

  insights.sort((a, b) => b.priority - a.priority || a.code.localeCompare(b.code))
  return {
    savingsRate: round(savingsRate),
    expenseRatio: expenseRatio === null ? null : round(expenseRatio),
    recurringShare: round(recurringShare),
    runwayMonths: runwayMonths === null ? null : round(runwayMonths, 2),
    recurringCoverageMonths: recurringCoverageMonths === null ? null : round(recurringCoverageMonths, 2),
    goalRemainingCents,
    monthsToFundGoals: monthsToFundGoals === null ? null : round(monthsToFundGoals, 1),
    resilienceScore,
    confidence: round(historyConfidence, 2),
    stressTest: {
      incomeChangePercent: -10,
      expenseChangePercent: 10,
      stressedFreeCashCents: Math.round(stressedFreeCash),
      survivable: incomeShockSurvivable,
    },
    insights,
  }
}
