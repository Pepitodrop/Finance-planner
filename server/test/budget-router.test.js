import assert from 'node:assert/strict'
import test from 'node:test'
import { createBudgetRouter } from '../src/budget-router.js'

const state = {
  accounts: [{ id: 'a1', name: 'Secret account name', type: 'checking', balanceCents: 500000, currency: 'EUR' }],
  transactions: [
    { id: '1', accountId: 'a1', description: 'Very private salary sender', category: 'Income', type: 'income', amountCents: 250000, date: '2026-07-01', recurring: true },
    { id: '2', accountId: 'a1', description: 'Very private merchant', category: 'Groceries', type: 'expense', amountCents: 50000, date: '2026-07-05', recurring: false },
  ],
  goals: [{ id: 'g1', name: 'Trip', targetCents: 300000, currentCents: 50000, targetDate: '2027-06-01' }],
}

function memoryProfileStore() {
  let profile = null
  let version = 0
  return {
    async get() { return { profile, version, updatedAt: null } },
    async update(_user, updater) { profile = await updater(profile); version += 1; return { profile, version, updatedAt: new Date().toISOString() } },
    async reset() { const existed = Boolean(profile); profile = null; version = 0; return existed },
  }
}

const planInput = {
  consentBehaviorLearning: true,
  consentExternalAi: false,
  consentLocationContext: true,
  location: { country: 'DE', region: 'Baden-Württemberg', city: 'Karlsruhe', costLevel: 'medium' },
  preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 70 },
}

test('budget planning authenticates before reading request data', async () => {
  let read = false
  const router = createBudgetRouter({
    env: {}, send: () => {}, body: async () => { read = true; return planInput },
    userId: () => { throw new Error('Authentication required.') },
    stateStore: { get: async () => ({ payload: { state } }) }, profileStore: memoryProfileStore(),
  })
  await assert.rejects(() => router({ method: 'POST' }, {}, new URL('http://localhost/api/ai/budget-plan')), /Authentication required/)
  assert.equal(read, false)
})

test('budget planning requires persistent-learning and location consent', async () => {
  const common = {
    env: {}, send: () => {}, userId: () => 'user-1',
    stateStore: { get: async () => ({ payload: { state } }) }, profileStore: memoryProfileStore(),
  }
  const noLearning = createBudgetRouter({ ...common, body: async () => ({ ...planInput, consentBehaviorLearning: false }) })
  await assert.rejects(() => noLearning({ method: 'POST' }, {}, new URL('http://localhost/api/ai/budget-plan')), (error) => error.code === 'behavior_consent_required')
  const noLocation = createBudgetRouter({ ...common, body: async () => ({ ...planInput, consentLocationContext: false }) })
  await assert.rejects(() => noLocation({ method: 'POST' }, {}, new URL('http://localhost/api/ai/budget-plan')), (error) => error.code === 'location_consent_required')
})

test('hosted budget explanation receives aggregates but no descriptions or account names', async () => {
  let sentBody = ''
  let payload
  const fetchImpl = async (_url, options) => {
    sentBody = String(options.body)
    const parsed = JSON.parse(sentBody)
    const ids = parsed.response_format.json_schema.schema.properties.explanations.items.properties.recommendationId.enum
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify({ summary: 'Ein vorsichtiger, lernender Monatsplan.', confidence: 0.7, explanations: [{ recommendationId: ids[0], explanation: 'Dieser Schritt passt zu deinem bestätigten Sicherheitsziel.' }] }) } }] }
      },
    }
  }
  const router = createBudgetRouter({
    env: { HF_TOKEN: 'token' },
    send: (_response, _status, value) => { payload = value },
    body: async () => ({ ...planInput, consentExternalAi: true }),
    userId: () => 'user-1',
    stateStore: { get: async () => ({ payload: { state } }) },
    profileStore: memoryProfileStore(), fetchImpl,
  })
  await router({ method: 'POST' }, {}, new URL('http://localhost/api/ai/budget-plan'))
  assert.equal(sentBody.includes('Very private merchant'), false)
  assert.equal(sentBody.includes('Secret account name'), false)
  assert.equal(sentBody.includes('Groceries'), false)
  assert.equal(sentBody.includes('Trip'), false)
  assert.equal(payload.privacy.descriptionsSentToModel, false)
  assert.equal(payload.privacy.coarseLocationSentToModel, true)
  assert.equal(payload.ai.source, 'hugging-face-budget-explanation')
  assert.ok(payload.recommendations.some((item) => item.aiExplanation))
})

test('budget feedback updates the persistent profile and reset deletes it', async () => {
  const profileStore = memoryProfileStore()
  const outputs = []
  const common = {
    env: {}, send: (_response, _status, value) => outputs.push(value), userId: () => 'user-1',
    stateStore: { get: async () => ({ payload: { state } }) }, profileStore,
  }
  const planner = createBudgetRouter({ ...common, body: async () => planInput })
  await planner({ method: 'POST' }, {}, new URL('http://localhost/api/ai/budget-plan'))
  const planId = outputs.at(-1).planId
  const feedback = createBudgetRouter({ ...common, body: async () => ({ consentBehaviorLearning: true, planId, recommendationId: 'goal-allocation', decision: 'approved' }) })
  await feedback({ method: 'POST' }, {}, new URL('http://localhost/api/ai/budget-feedback'))
  assert.equal(outputs.at(-1).profile.feedbackSummary['goal-allocation'].approved, 1)
  const reset = createBudgetRouter({ ...common, body: async () => ({}) })
  await reset({ method: 'DELETE' }, {}, new URL('http://localhost/api/ai/budget-profile'))
  assert.equal(outputs.at(-1).reset, true)
})
