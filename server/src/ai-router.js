import { createHuggingFaceChatTransport } from './huggingFaceClient.js'
import { HttpError } from './runtime-security.js'
import { publicModelCatalog } from './ai-model-catalog.js'
import { learnBehaviorPatterns } from './behavior-learning.js'

const DEFAULT_MODEL = 'Qwen/Qwen3-4B-Thinking-2507:fastest'
const ALLOWED_SIGNAL_TYPES = new Set(['cashflow', 'recurring-cost', 'goal-risk', 'anomaly', 'data-quality'])
const ALLOWED_SEVERITIES = new Set(['info', 'warning', 'critical'])

function finiteInteger(value, field, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, 'invalid_ai_snapshot', `${field} must be a safe integer.`)
  return value
}

function validateSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_ai_snapshot', 'snapshot must be an object.')
  const allowed = new Set(['incomeCents', 'expenseCents', 'freeCashCents', 'recurringExpenseCents', 'accountBalanceCents', 'transactionCount', 'monthsCovered', 'categoryTotals', 'goals'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new HttpError(400, 'invalid_ai_snapshot', `Unexpected snapshot field: ${key}`)
  const categoryTotals = Array.isArray(value.categoryTotals) ? value.categoryTotals.slice(0, 8).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['rank', 'amountCents'].includes(key))) throw new HttpError(400, 'invalid_ai_snapshot', 'categoryTotals may contain only rank and amountCents.')
    return { rank: finiteInteger(item.rank, `categoryTotals[${index}].rank`, { min: 1, max: 8 }), amountCents: finiteInteger(item.amountCents, `categoryTotals[${index}].amountCents`, { min: 0 }) }
  }) : []
  const goals = Array.isArray(value.goals) ? value.goals.slice(0, 20).map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['remainingCents', 'targetDate'].includes(key))) throw new HttpError(400, 'invalid_ai_snapshot', 'goals may contain only remainingCents and targetDate.')
    const targetDate = String(item.targetDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new HttpError(400, 'invalid_ai_snapshot', `goals[${index}].targetDate is invalid.`)
    return { remainingCents: finiteInteger(item.remainingCents, `goals[${index}].remainingCents`, { min: 0 }), targetDate }
  }) : []
  return {
    incomeCents: finiteInteger(value.incomeCents, 'incomeCents', { min: 0 }), expenseCents: finiteInteger(value.expenseCents, 'expenseCents', { min: 0 }),
    freeCashCents: finiteInteger(value.freeCashCents, 'freeCashCents'), recurringExpenseCents: finiteInteger(value.recurringExpenseCents, 'recurringExpenseCents', { min: 0 }),
    accountBalanceCents: finiteInteger(value.accountBalanceCents, 'accountBalanceCents'), transactionCount: finiteInteger(value.transactionCount, 'transactionCount', { min: 0 }),
    monthsCovered: finiteInteger(value.monthsCovered, 'monthsCovered', { min: 0, max: 1200 }), categoryTotals, goals,
  }
}

function clampConfidence(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return JSON.parse(fenced ?? (start >= 0 && end >= start ? text.slice(start, end + 1) : text))
}

function validateModelResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI response is not an object')
  const allowedRoot = new Set(['summary', 'confidence', 'signals'])
  for (const key of Object.keys(value)) if (!allowedRoot.has(key)) throw new Error(`Unexpected AI response field: ${key}`)
  if (typeof value.summary !== 'string' || value.summary.trim().length < 1 || value.summary.length > 800) throw new Error('AI summary is invalid')
  if (!Array.isArray(value.signals) || value.signals.length > 8) throw new Error('AI signals are invalid')
  const signals = value.signals.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('AI signal is invalid')
    const allowedSignal = new Set(['type', 'severity', 'title', 'explanation', 'confidence', 'evidence', 'suggestedAction', 'requiresApproval'])
    for (const key of Object.keys(item)) if (!allowedSignal.has(key)) throw new Error(`Unexpected AI signal field: ${key}`)
    if (!ALLOWED_SIGNAL_TYPES.has(item.type)) throw new Error('AI signal type is invalid')
    if (!ALLOWED_SEVERITIES.has(item.severity)) throw new Error('AI signal severity is invalid')
    if (typeof item.title !== 'string' || item.title.trim().length < 1 || item.title.length > 140) throw new Error('AI signal title is invalid')
    if (typeof item.explanation !== 'string' || item.explanation.trim().length < 1 || item.explanation.length > 600) throw new Error('AI signal explanation is invalid')
    if (!Array.isArray(item.evidence) || item.evidence.length > 5 || !item.evidence.every((entry) => typeof entry === 'string' && entry.length <= 200)) throw new Error('AI evidence is invalid')
    if (item.suggestedAction !== undefined && (typeof item.suggestedAction !== 'string' || item.suggestedAction.length > 300)) throw new Error('AI suggested action is invalid')
    return { type: item.type, severity: item.severity, title: item.title, explanation: item.explanation, confidence: clampConfidence(item.confidence), evidence: item.evidence, ...(item.suggestedAction ? { suggestedAction: item.suggestedAction } : {}), requiresApproval: true }
  })
  return { summary: value.summary, confidence: clampConfidence(value.confidence), signals }
}

function deterministicFallback(snapshot, warning) {
  const signals = []
  if (snapshot.freeCashCents <= 0) signals.push({ type: 'cashflow', severity: 'critical', title: 'Cashflow ist nicht positiv', explanation: 'Die erfassten Ausgaben übersteigen oder entsprechen den Einnahmen.', confidence: 0.98, evidence: [`incomeCents=${snapshot.incomeCents}`, `expenseCents=${snapshot.expenseCents}`], suggestedAction: 'Ausgaben prüfen und vor neuen Sparzuweisungen einen Liquiditätspuffer herstellen.', requiresApproval: true })
  if (snapshot.recurringExpenseCents > 0) signals.push({ type: 'recurring-cost', severity: 'warning', title: 'Wiederkehrende Kosten prüfen', explanation: 'Wiederkehrende Ausgaben sollten regelmäßig einzeln überprüft werden.', confidence: 0.95, evidence: [`recurringExpenseCents=${snapshot.recurringExpenseCents}`], suggestedAction: 'Abonnements und feste Verträge einzeln bestätigen oder kündigen.', requiresApproval: true })
  if (snapshot.transactionCount < 15 || snapshot.monthsCovered < 3) signals.push({ type: 'data-quality', severity: 'info', title: 'Noch wenig belastbare Historie', explanation: 'Prognosen und personalisierte Empfehlungen sind wegen der begrenzten Datenbasis vorsichtig zu interpretieren.', confidence: 0.99, evidence: [`transactionCount=${snapshot.transactionCount}`, `monthsCovered=${snapshot.monthsCovered}`], requiresApproval: true })
  return { summary: signals.length ? 'Regelbasierte Analyse verfügbar; das Sprachmodell konnte nicht sicher verwendet werden.' : 'Keine dringenden regelbasierten Risiken erkannt.', signals, confidence: signals.length ? 0.86 : 0.7, source: 'deterministic-fallback', generatedAt: new Date().toISOString(), warnings: [String(warning).slice(0, 300)] }
}

export function createAiRouter({ env, send, body, userId, transportFactory = createHuggingFaceChatTransport, loadBehaviorEvents = null }) {
  const transport = env.HF_TOKEN ? transportFactory({ token: env.HF_TOKEN, timeoutMs: Number(env.HF_TIMEOUT_MS || 12_000) }) : null
  return async function handleAi(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/ai/models') {
      userId(request)
      send(response, 200, { models: publicModelCatalog(), note: 'Only models marked integrated have an active inference path. Catalog-only models require a separately configured worker.' })
      return true
    }
    if (request.method === 'POST' && url.pathname === '/api/ai/behavior-prediction') {
      const user = userId(request)
      const input = await body(request)
      if (input.consentBehaviorLearning !== true) throw new HttpError(400, 'behavior_consent_required', 'Explicit consent is required for behavior learning.')
      if (Object.keys(input).some((key) => !['consentBehaviorLearning'].includes(key))) throw new HttpError(400, 'invalid_behavior_request', 'Behavior history must be loaded by the server and must not be supplied by the client.')
      if (typeof loadBehaviorEvents !== 'function') throw new HttpError(503, 'behavior_history_unavailable', 'Trusted server-side financial history is not configured.')
      const events = await loadBehaviorEvents(user)
      send(response, 200, learnBehaviorPatterns(events))
      return true
    }
    if (request.method !== 'POST' || url.pathname !== '/api/ai/financial-intelligence') return false
    userId(request)
    const input = await body(request)
    if (input.consentExternalAi !== true) throw new HttpError(400, 'ai_consent_required', 'Explicit consent is required before external AI inference.')
    if (!transport) throw new HttpError(503, 'ai_unavailable', 'Hugging Face inference is not configured.')
    const snapshot = validateSnapshot(input.snapshot)
    const model = String(env.HF_MODEL || DEFAULT_MODEL)
    try {
      const content = await transport.chatCompletion({ model, temperature: 0.1, maxTokens: 900, messages: [{ role: 'system', content: 'Du bist ein vorsichtiger Finanzanalyse-Assistent. Nutze ausschließlich die aggregierten Fakten. Erfinde keine Transaktionen, stelle keine Rechts-, Steuer- oder Anlageberatung als sicher dar und führe keine Aktion aus. Antworte ausschließlich als JSON mit summary, confidence und signals. Zulässige type-Werte: cashflow, recurring-cost, goal-risk, anomaly, data-quality. Jede Empfehlung bleibt genehmigungspflichtig.' }, { role: 'user', content: `Analysiere diesen anonymisierten Finanz-Snapshot: ${JSON.stringify(snapshot)}` }] })
      const validated = validateModelResult(extractJson(content))
      send(response, 200, { ...validated, source: 'hugging-face', model, generatedAt: new Date().toISOString(), warnings: [] })
    } catch (error) {
      send(response, 200, deterministicFallback(snapshot, error instanceof Error ? error.message : 'Hugging Face inference failed'))
    }
    return true
  }
}
