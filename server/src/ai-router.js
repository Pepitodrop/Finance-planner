import { createHuggingFaceChatTransport } from './huggingFaceClient.js'
import { HttpError } from './runtime-security.js'

const DEFAULT_MODEL = 'Qwen/Qwen3-4B-Thinking-2507:fastest'

function finiteInteger(value, field, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(400, 'invalid_ai_snapshot', `${field} must be a safe integer.`)
  }
  return value
}

function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_ai_snapshot', 'snapshot must be an object.')
  const allowed = new Set(['incomeCents', 'expenseCents', 'freeCashCents', 'recurringExpenseCents', 'accountBalanceCents', 'transactionCount', 'monthsCovered', 'categoryTotals', 'goals'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new HttpError(400, 'invalid_ai_snapshot', `Unexpected snapshot field: ${key}`)

  const categoryTotals = Array.isArray(value.categoryTotals) ? value.categoryTotals.slice(0, 8).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['rank', 'amountCents'].includes(key))) {
      throw new HttpError(400, 'invalid_ai_snapshot', 'categoryTotals may contain only rank and amountCents.')
    }
    return {
      rank: finiteInteger(item.rank, `categoryTotals[${index}].rank`, { min: 1, max: 8 }),
      amountCents: finiteInteger(item.amountCents, `categoryTotals[${index}].amountCents`, { min: 0 }),
    }
  }) : []

  const goals = Array.isArray(value.goals) ? value.goals.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['remainingCents', 'targetDate'].includes(key))) {
      throw new HttpError(400, 'invalid_ai_snapshot', 'goals may contain only remainingCents and targetDate.')
    }
    const targetDate = String(item.targetDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new HttpError(400, 'invalid_ai_snapshot', `goals[${index}].targetDate is invalid.`)
    return { remainingCents: finiteInteger(item.remainingCents, `goals[${index}].remainingCents`, { min: 0 }), targetDate }
  }) : []

  return {
    incomeCents: finiteInteger(value.incomeCents, 'incomeCents', { min: 0 }),
    expenseCents: finiteInteger(value.expenseCents, 'expenseCents', { min: 0 }),
    freeCashCents: finiteInteger(value.freeCashCents, 'freeCashCents'),
    recurringExpenseCents: finiteInteger(value.recurringExpenseCents, 'recurringExpenseCents', { min: 0 }),
    accountBalanceCents: finiteInteger(value.accountBalanceCents, 'accountBalanceCents'),
    transactionCount: finiteInteger(value.transactionCount, 'transactionCount', { min: 0 }),
    monthsCovered: finiteInteger(value.monthsCovered, 'monthsCovered', { min: 0, max: 1200 }),
    categoryTotals,
    goals,
  }
}

export function createAiRouter({ env, send, body, userId }) {
  const transport = env.HF_TOKEN ? createHuggingFaceChatTransport({
    token: env.HF_TOKEN,
    timeoutMs: Number(env.HF_TIMEOUT_MS || 12_000),
  }) : null

  return async function handleAi(request, response, url) {
    if (request.method !== 'POST' || url.pathname !== '/api/ai/financial-intelligence') return false
    userId(request)
    const input = await body(request)
    if (input.consentExternalAi !== true) throw new HttpError(400, 'ai_consent_required', 'Explicit consent is required before external AI inference.')
    if (!transport) throw new HttpError(503, 'ai_unavailable', 'Hugging Face inference is not configured.')

    const snapshot = validateSnapshot(input.snapshot)
    const model = String(env.HF_MODEL || DEFAULT_MODEL)
    const content = await transport.chatCompletion({
      model,
      temperature: 0.1,
      maxTokens: 900,
      messages: [
        {
          role: 'system',
          content: 'Du bist ein vorsichtiger Finanzanalyse-Assistent. Nutze ausschließlich die aggregierten Fakten. Erfinde keine Transaktionen und führe keine Aktion aus. Antworte ausschließlich als JSON mit summary, confidence und signals.',
        },
        { role: 'user', content: `Analysiere diesen anonymisierten Finanz-Snapshot: ${JSON.stringify(snapshot)}` },
      ],
    })

    send(response, 200, { model, content })
    return true
  }
}
