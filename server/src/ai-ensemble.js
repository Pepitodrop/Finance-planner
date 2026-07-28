const REVIEWED_MODEL_REVISIONS = Object.freeze({
  analyst: new Map([
    ['Qwen/Qwen3-4B-Thinking-2507:fastest', '768f209d9ea81521153ed38c47d515654e938aea'],
  ]),
  critic: new Map([
    ['Qwen/Qwen3-4B-Instruct-2507:fastest', '1b4199c4f36b0cef378bfb12390c18780c18af4c'],
  ]),
})

const MINIMUM_ENSEMBLE_AGREEMENT = 0.67

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

function signalKey(signal) {
  return `${signal.type}:${signal.severity}`
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
  if (!models.critic) return { result: analyst, modelsUsed: [models.analyst], agreement: null, abstained: false }

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
  const analystKeys = new Set(analyst.signals.map(signalKey))
  const criticKeys = new Set(critic.signals.map(signalKey))
  const agreedSignals = critic.signals.filter((signal) => analystKeys.has(signalKey(signal)))
  const unionSize = new Set([...analystKeys, ...criticKeys]).size
  const agreement = unionSize === 0 ? 1 : agreedSignals.length / unionSize
  const roundedAgreement = Number(agreement.toFixed(2))

  if (roundedAgreement < MINIMUM_ENSEMBLE_AGREEMENT) {
    return {
      result: {
        summary: 'Die Modelle waren sich nicht ausreichend einig. Es wurden keine KI-Hinweise übernommen.',
        confidence: Math.min(analyst.confidence, critic.confidence, 0.4),
        signals: [],
      },
      modelsUsed: [models.analyst, models.critic],
      agreement: roundedAgreement,
      abstained: true,
      abstentionReason: 'insufficient_model_agreement',
    }
  }

  return {
    result: { ...critic, confidence: Math.min(critic.confidence, analyst.confidence, 0.95), signals: agreedSignals },
    modelsUsed: [models.analyst, models.critic],
    agreement: roundedAgreement,
    abstained: false,
  }
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null
}

function monthsUntil(targetDate) {
  const target = new Date(`${targetDate}T00:00:00Z`)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const months = (target.getUTCFullYear() - now.getUTCFullYear()) * 12 + target.getUTCMonth() - now.getUTCMonth()
  return Math.max(1, months)
}

export function deterministicScenarioInsights(snapshot) {
  const insights = []
  const savingsRateRaw = safeRatio(snapshot.freeCashCents, snapshot.incomeCents)
  const savingsRate = savingsRateRaw ?? 0
  const recurringShareRaw = safeRatio(snapshot.recurringExpenseCents, snapshot.expenseCents)
  const recurringShare = recurringShareRaw ?? 0

  if (savingsRate < 0.1) insights.push({ code: 'low_savings_rate', value: Number(savingsRate.toFixed(3)), severity: savingsRate <= 0 ? 'critical' : 'warning' })
  if (recurringShare > 0.6) insights.push({ code: 'high_recurring_share', value: Number(recurringShare.toFixed(3)), severity: 'warning' })

  const monthlyBurn = snapshot.monthsCovered > 0 ? snapshot.expenseCents / snapshot.monthsCovered : snapshot.expenseCents
  const runwayMonths = monthlyBurn > 0 ? snapshot.accountBalanceCents / monthlyBurn : null
  if (runwayMonths !== null && runwayMonths < 3) insights.push({ code: 'low_liquidity_runway', value: Number(runwayMonths.toFixed(2)), severity: runwayMonths < 1 ? 'critical' : 'warning' })

  const stressExpenseCents = Math.round(snapshot.expenseCents * 1.15)
  const stressedFreeCashCents = snapshot.incomeCents - stressExpenseCents
  const stressResilient = stressedFreeCashCents >= 0
  if (!stressResilient) insights.push({ code: 'expense_stress_failure', value: stressedFreeCashCents, severity: 'warning' })

  const goalFeasibility = snapshot.goals.map((goal, index) => {
    const monthsRemaining = monthsUntil(goal.targetDate)
    const requiredMonthlyCents = monthsRemaining ? Math.ceil(goal.remainingCents / monthsRemaining) : goal.remainingCents
    const coverageRatio = snapshot.freeCashCents > 0 ? snapshot.freeCashCents / requiredMonthlyCents : 0
    const feasible = coverageRatio >= 1
    if (!feasible) insights.push({ code: 'goal_funding_gap', goalIndex: index, value: Number(coverageRatio.toFixed(3)), severity: coverageRatio < 0.5 ? 'critical' : 'warning' })
    return {
      goalIndex: index,
      targetDate: goal.targetDate,
      monthsRemaining,
      requiredMonthlyCents,
      coverageRatio: Number(coverageRatio.toFixed(3)),
      feasible,
    }
  })

  return {
    savingsRate: Number(savingsRate.toFixed(3)),
    recurringShare: Number(recurringShare.toFixed(3)),
    runwayMonths: runwayMonths === null ? null : Number(runwayMonths.toFixed(2)),
    stressTest: {
      expenseIncreasePercent: 15,
      stressedExpenseCents,
      stressedFreeCashCents,
      resilient: stressResilient,
    },
    goalFeasibility,
    insights,
  }
}
