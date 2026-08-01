import { isIP } from 'node:net'
import { clientIp, HttpError } from './runtime-security.js'
import {
  applyBudgetFeedback,
  buildBudgetSnapshot,
  createDeterministicBudgetPlan,
  publicLearningProfile,
  updateLearningProfile,
  validateBudgetPreferences,
} from './budget-learning.js'

const BUDGET_MODEL = Object.freeze({
  id: 'Qwen/Qwen3-4B-Instruct-2507:fastest',
  license: 'Apache-2.0',
  routing: 'hugging-face-provider-managed',
})
const IP_GEOLOCATION_ENDPOINT = 'https://ipwho.is'
const ALLOWED_FEEDBACK_IDS = new Set(['resolve-deficit', 'emergency-fund', 'goal-allocation', 'review-recurring-costs', 'smooth-spending', 'reduce-flexible-spending', 'sustainable-budget', 'location-context'])
const PLAN_ID = /^budget-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const GEO_LABEL = /^[\p{L}\p{M}0-9 .,'’()\-]{1,100}$/u
const GEO_INSTRUCTION_TEXT = /\b(?:ignore|previous|instruction|prompt|system|assistant|developer|password|secret|token|transfer|überweisung)\b/i
const AI_EMPHASIS = new Set(['priority', 'habit', 'caution', 'motivation'])
const SAFE_AI_EXPLANATIONS = Object.freeze({
  priority: 'Diese Empfehlung ist im aktuellen Plan besonders wichtig.',
  habit: 'Diese Empfehlung eignet sich als wiederkehrende Gewohnheit.',
  caution: 'Setze diese Empfehlung schrittweise um und prüfe die Wirkung.',
  motivation: 'Diese Empfehlung unterstützt deine bestätigten Präferenzen.',
})

function normalizeIp(value) {
  let ip = String(value || '').trim()
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'))
  if (ip.includes('%')) ip = ip.slice(0, ip.indexOf('%'))
  if (ip.toLowerCase().startsWith('::ffff:')) ip = ip.slice(7)
  return ip
}

function isPublicIp(value) {
  const ip = normalizeIp(value)
  const version = isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 0 || b === 168)) return false
    if (a === 198 && (b === 18 || b === 19 || b === 51)) return false
    if (a === 203 && b === 0) return false
    return true
  }
  if (version === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd')) return false
    if (/^fe[89ab]/.test(lower) || lower.startsWith('ff') || lower.startsWith('2001:db8:')) return false
    return true
  }
  return false
}

function safeGeoLabel(value) {
  if (typeof value !== 'string') return null
  const text = value.normalize('NFKC').trim()
  if (!GEO_LABEL.test(text) || GEO_INSTRUCTION_TEXT.test(text)) return null
  return text
}

function sanitizeIpLocation(value) {
  if (!value || value.success !== true) throw new Error('IP geolocation failed.')
  const country = String(value.country_code || '').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('IP geolocation returned no valid country.')
  return {
    country,
    region: safeGeoLabel(value.region),
    city: safeGeoLabel(value.city),
    costLevel: 'unknown',
  }
}

async function resolveIpLocation({ request, env, fetchImpl }) {
  const remote = env.TRUST_PROXY === 'true' ? clientIp(request) : request.socket?.remoteAddress
  const ip = normalizeIp(remote)
  if (!isPublicIp(ip)) throw new Error('A public client IP is unavailable.')
  const timeoutMs = Number(env.IP_GEOLOCATION_TIMEOUT_MS || 4_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 10_000) throw new Error('IP_GEOLOCATION_TIMEOUT_MS must be between 1000 and 10000.')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('IP geolocation timed out.')), timeoutMs)
  try {
    const response = await fetchImpl(`${IP_GEOLOCATION_ENDPOINT}/${encodeURIComponent(ip)}?fields=success,country_code,region,city&lang=de`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('IP geolocation provider failed.')
    return sanitizeIpLocation(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

function extractJson(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16_384) throw new Error('Budget AI response is invalid')
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  return JSON.parse(fenced ?? (start >= 0 && end >= start ? text.slice(start, end + 1) : text))
}

function validateBudgetModelResult(value, recommendationIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Budget AI response is not an object')
  if (Object.keys(value).some((key) => !['confidence', 'explanations'].includes(key))) throw new Error('Budget AI response contains an unexpected field')
  const confidence = Number(value.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence is invalid')
  if (!Array.isArray(value.explanations) || value.explanations.length > 8) throw new Error('explanations is invalid')
  const seen = new Set()
  const explanations = value.explanations.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`explanations[${index}] is invalid`)
    if (Object.keys(item).some((key) => !['recommendationId', 'emphasis'].includes(key))) throw new Error(`explanations[${index}] contains an unexpected field`)
    const recommendationId = String(item.recommendationId || '')
    const emphasis = String(item.emphasis || '')
    if (!recommendationIds.has(recommendationId) || seen.has(recommendationId)) throw new Error(`explanations[${index}].recommendationId is invalid`)
    if (!AI_EMPHASIS.has(emphasis)) throw new Error(`explanations[${index}].emphasis is invalid`)
    seen.add(recommendationId)
    return { recommendationId, explanation: SAFE_AI_EXPLANATIONS[emphasis] }
  })
  return { confidence: Number(confidence.toFixed(2)), explanations }
}

function validatePlanRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_budget_request', 'Budget-plan input must be an object.')
  if (Object.keys(input).some((key) => !['consentBehaviorLearning', 'consentExternalAi', 'consentLocationContext', 'preferences'].includes(key))) {
    throw new HttpError(400, 'invalid_budget_request', 'Unexpected budget-plan request field.')
  }
  if (input.consentBehaviorLearning !== true) throw new HttpError(400, 'behavior_consent_required', 'Explicit consent is required for persistent behavior learning.')
  if (input.consentExternalAi !== undefined && typeof input.consentExternalAi !== 'boolean') throw new HttpError(400, 'invalid_budget_request', 'consentExternalAi must be boolean.')
  if (input.consentLocationContext !== undefined && typeof input.consentLocationContext !== 'boolean') throw new HttpError(400, 'invalid_budget_request', 'consentLocationContext must be boolean.')
  return {
    consentExternalAi: input.consentExternalAi === true,
    consentLocationContext: input.consentLocationContext === true,
    preferences: validateBudgetPreferences(input.preferences),
  }
}

function validateFeedbackRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_budget_feedback', 'Feedback input must be an object.')
  if (Object.keys(input).some((key) => !['consentBehaviorLearning', 'planId', 'recommendationId', 'decision'].includes(key))) throw new HttpError(400, 'invalid_budget_feedback', 'Unexpected feedback field.')
  if (input.consentBehaviorLearning !== true) throw new HttpError(400, 'behavior_consent_required', 'Explicit consent is required for persistent behavior learning.')
  const planId = String(input.planId || '')
  if (!PLAN_ID.test(planId)) throw new HttpError(400, 'invalid_budget_feedback', 'planId is invalid.')
  return { planId, recommendationId: String(input.recommendationId || ''), decision: String(input.decision || '') }
}

function deterministicSummary(plan) {
  const allocation = plan.allocations
  if (plan.cashflowStatus === 'deficit') {
    return `Die historischen Monatsausgaben liegen ${plan.monthlyDeficitCents} Cent über den Einnahmen. Deshalb werden aktuell keine Beiträge für Notgroschen oder Sparziele eingeplant; die verfügbaren Einnahmen werden vollständig und ohne Überallokation verteilt.`
  }
  return `Der monatliche Budgetvorschlag reserviert ${allocation.essentialCents} Cent für Grundbedarf, ${allocation.flexibleCents} Cent für flexible Ausgaben, ${allocation.emergencyFundCents} Cent für den Notgroschen und ${allocation.savingsGoalsCents} Cent für aktive Sparziele.`
}

async function enrichWithHuggingFace({ env, fetchImpl, plan, profile, location }) {
  if (!env.HF_TOKEN) return { confidence: plan.confidence, source: 'deterministic-budget-engine', model: null, warnings: ['Hugging Face inference is not configured.'], explanations: [] }
  const model = env.HF_BUDGET_MODEL || BUDGET_MODEL.id
  if (model !== BUDGET_MODEL.id) throw new Error('HF_BUDGET_MODEL must match the reviewed allowlist.')
  const timeoutMs = Number(env.HF_BUDGET_TIMEOUT_MS || 30_000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 90_000) throw new Error('HF_BUDGET_TIMEOUT_MS must be between 5000 and 90000.')
  const ids = new Set(plan.recommendations.map((item) => item.id))
  const context = {
    plan: {
      cashflowStatus: plan.cashflowStatus,
      monthlyDeficitCents: plan.monthlyDeficitCents,
      allocations: plan.allocations,
      emergencyFund: plan.emergencyFund,
      goalAllocations: plan.goalAllocations.map((goal, index) => ({ rank: index + 1, targetDate: goal.targetDate, remainingCents: goal.remainingCents, recommendedMonthlyCents: goal.recommendedMonthlyCents, requiredMonthlyCents: goal.requiredMonthlyCents, onTrack: goal.onTrack })),
      categoryCaps: plan.categoryCaps.map((category, index) => ({ rank: index + 1, historicalMonthlyCents: category.historicalMonthlyCents, recommendedCapCents: category.recommendedCapCents })),
      recommendations: plan.recommendations.map(({ id, priority, title }) => ({ id, priority, title })),
      dataQuality: plan.dataQuality,
    },
    learnedProfile: {
      preferences: profile.preferences,
      location: location ? { country: location.country } : null,
      patterns: { ...profile.patterns, categoryPreferences: profile.patterns.categoryPreferences.map((category, index) => ({ rank: index + 1, monthlyAverageCents: category.monthlyAverageCents, weight: category.weight })) },
      confidence: profile.confidence,
      feedbackSummary: publicLearningProfile(profile).feedbackSummary,
    },
  }
  const schema = {
    type: 'object', additionalProperties: false, required: ['confidence', 'explanations'],
    properties: {
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      explanations: {
        type: 'array', maxItems: 8,
        items: {
          type: 'object', additionalProperties: false, required: ['recommendationId', 'emphasis'],
          properties: {
            recommendationId: { type: 'string', enum: [...ids] },
            emphasis: { type: 'string', enum: [...AI_EMPHASIS] },
          },
        },
      },
    },
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Budget AI timed out')), timeoutMs)
  try {
    const response = await fetchImpl('https://router.huggingface.co/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.HF_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              'Du klassifizierst ausschließlich die Betonung bereits berechneter Budgetempfehlungen.',
              'Gib keine freie Erklärung, keine Zahl, keinen Betrag, kein Datum und keine neue Tatsachenbehauptung aus.',
              'Wähle pro Empfehlung nur eine erlaubte emphasis-Kategorie aus dem JSON-Schema.',
              'Die Budgetzahlen sind unveränderlich und jede Empfehlung bleibt freigabepflichtig.',
              'Antworte ausschließlich als JSON nach dem Schema.',
            ].join(' '),
          },
          { role: 'user', content: `Verifizierter Budgetkontext: ${JSON.stringify(context)}` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'learning_budget_emphasis', strict: true, schema } },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.text().catch(() => '')
      throw new Error(`Hugging Face budget inference failed (${response.status})`)
    }
    const payload = await response.json()
    const result = validateBudgetModelResult(extractJson(payload?.choices?.[0]?.message?.content), ids)
    return { ...result, source: 'hugging-face-budget-explanation', model: { id: model, license: BUDGET_MODEL.license, routing: BUDGET_MODEL.routing }, warnings: [] }
  } finally {
    clearTimeout(timeout)
  }
}

export function createBudgetRouter({ env = process.env, send, body, userId, stateStore, profileStore, fetchImpl = fetch }) {
  return async function handleBudget(request, response, url) {
    if (!url.pathname.startsWith('/api/ai/budget-')) return false
    const user = userId(request)
    if (!stateStore || !profileStore) throw new HttpError(503, 'budget_learning_unavailable', 'Persistent budget learning requires PostgreSQL cloud state.')

    if (request.method === 'GET' && url.pathname === '/api/ai/budget-profile') {
      const stored = await profileStore.get(user)
      send(response, 200, { profile: publicLearningProfile(stored.profile), version: stored.version, updatedAt: stored.updatedAt })
      return true
    }

    if (request.method === 'DELETE' && url.pathname === '/api/ai/budget-profile') {
      const removed = await profileStore.reset(user)
      send(response, 200, { reset: true, previouslyStored: removed })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/ai/budget-feedback') {
      const input = validateFeedbackRequest(await body(request))
      if (!ALLOWED_FEEDBACK_IDS.has(input.recommendationId)) throw new HttpError(400, 'invalid_budget_feedback', 'recommendationId is invalid.')
      const updated = await profileStore.update(user, (profile) => {
        if (profile?.lastPlanId !== input.planId) throw new HttpError(409, 'stale_budget_feedback', 'Feedback must refer to the most recently generated budget plan.')
        if (!Array.isArray(profile.lastPlanRecommendationIds) || !profile.lastPlanRecommendationIds.includes(input.recommendationId)) {
          throw new HttpError(409, 'unknown_plan_recommendation', 'Feedback must refer to a recommendation that was issued in the latest plan.')
        }
        return applyBudgetFeedback(profile, input.planId, input.recommendationId, input.decision)
      })
      send(response, 200, { learned: true, planId: input.planId, recommendationId: input.recommendationId, decision: input.decision, profile: publicLearningProfile(updated.profile), version: updated.version })
      return true
    }

    if (request.method === 'POST' && url.pathname === '/api/ai/budget-plan') {
      const input = validatePlanRequest(await body(request))
      const cloud = await stateStore.get(user)
      if (!cloud.payload) throw new HttpError(409, 'budget_history_missing', 'No synchronized finance history is available for budget learning.')
      const snapshot = buildBudgetSnapshot(cloud.payload.state)
      let location = null
      const warnings = []
      if (input.consentLocationContext) {
        try {
          location = await resolveIpLocation({ request, env, fetchImpl })
        } catch {
          warnings.push('Der ungefähre IP-Standort konnte nicht bestimmt werden; der Plan wurde ohne Standortkontext erstellt.')
        }
      }
      const stored = await profileStore.update(user, (existing) => updateLearningProfile(existing, snapshot, { ...input, location }))
      const plan = createDeterministicBudgetPlan(snapshot, stored.profile, new Date(), { useLocation: Boolean(location) })
      const issued = await profileStore.update(user, (profile) => ({
        ...profile,
        lastPlanId: plan.planId,
        lastPlanRecommendationIds: plan.recommendations.map((item) => item.id),
      }))
      let ai
      if (input.consentExternalAi) {
        try {
          ai = await enrichWithHuggingFace({ env, fetchImpl, plan, profile: issued.profile, location })
        } catch {
          ai = { confidence: plan.confidence, source: 'deterministic-budget-engine', model: null, warnings: ['Die optionale KI-Betonung war nicht verfügbar.'], explanations: [] }
        }
      } else {
        ai = { confidence: plan.confidence, source: 'deterministic-budget-engine', model: null, warnings: [], explanations: [] }
      }
      const explanationMap = new Map(ai.explanations.map((item) => [item.recommendationId, item.explanation]))
      const recommendations = plan.recommendations.map((item) => ({ ...item, aiExplanation: explanationMap.get(item.id) || null }))
      send(response, 200, {
        ...plan,
        recommendations,
        summary: deterministicSummary(plan),
        locationContext: location,
        ai: { source: ai.source, model: ai.model, confidence: Math.min(ai.confidence, plan.confidence), warnings: [...warnings, ...ai.warnings] },
        learningProfile: publicLearningProfile(issued.profile),
        profileVersion: issued.version,
        privacy: {
          descriptionsSentToModel: false,
          accountNamesSentToModel: false,
          preciseLocationSentToModel: false,
          coarseLocationSentToModel: ai.source === 'hugging-face-budget-explanation' && Boolean(location),
          ipAddressPersisted: false,
          ipLocationLookupRequested: input.consentLocationContext,
          automaticMoneyMovement: false,
        },
      })
      return true
    }

    return false
  }
}
