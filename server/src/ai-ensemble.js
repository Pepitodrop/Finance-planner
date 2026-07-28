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

export function deterministicScenarioInsights(snapshot) {
  const insights = []
  const savingsRate = snapshot.incomeCents > 0 ? snapshot.freeCashCents / snapshot.incomeCents : 0
  const recurringShare = snapshot.expenseCents > 0 ? snapshot.recurringExpenseCents / snapshot.expenseCents : 0
  if (savingsRate < 0.1) insights.push({ code: 'low_savings_rate', value: Number(savingsRate.toFixed(3)), severity: savingsRate <= 0 ? 'critical' : 'warning' })
  if (recurringShare > 0.6) insights.push({ code: 'high_recurring_share', value: Number(recurringShare.toFixed(3)), severity: 'warning' })
  const monthlyBurn = snapshot.monthsCovered > 0 ? snapshot.expenseCents / snapshot.monthsCovered : snapshot.expenseCents
  const runwayMonths = monthlyBurn > 0 ? snapshot.accountBalanceCents / monthlyBurn : null
  if (runwayMonths !== null && runwayMonths < 3) insights.push({ code: 'low_liquidity_runway', value: Number(runwayMonths.toFixed(2)), severity: runwayMonths < 1 ? 'critical' : 'warning' })
  return { savingsRate: Number(savingsRate.toFixed(3)), recurringShare: Number(recurringShare.toFixed(3)), runwayMonths: runwayMonths === null ? null : Number(runwayMonths.toFixed(2)), insights }
}
