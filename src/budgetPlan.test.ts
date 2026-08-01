import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestLearningBudgetPlan, submitBudgetFeedback } from './budgetPlan'

const profile = {
  enabled: true,
  preferences: { savingsStyle: 'balanced' as const, emergencyFundMonths: 3, sustainabilityPriority: 60 },
  location: { country: 'DE', region: 'Baden-Württemberg', city: 'Karlsruhe', costLevel: 'unknown' as const },
  patterns: { categoryPreferences: [], monthlyIncomeCents: 250000, monthlyExpenseCents: 120000, monthlyRecurringCents: 80000, savingsCapacityCents: 130000, volatilityCents: 1000, goalCount: 1 },
  confidence: 0.7,
  learnedFromTransactions: 20,
  firstLearnedAt: '2026-08-01T00:00:00.000Z',
  lastLearnedAt: '2026-08-01T00:00:00.000Z',
  feedbackSummary: {},
  privacy: { rawDescriptionsPersisted: false, preciseCoordinatesPersisted: false, externalInferenceRequiresConsent: true, userCanReset: true },
}

const plan = {
  planId: 'budget-2026-08-01-123e4567-e89b-42d3-a456-426614174000',
  period: 'monthly' as const,
  generatedAt: '2026-08-01T00:00:00.000Z',
  cashflowStatus: 'balanced' as const,
  monthlyDeficitCents: 0,
  summary: 'Plan',
  locationContext: { country: 'DE', region: 'Baden-Württemberg', city: 'Karlsruhe', costLevel: 'unknown' as const },
  allocations: { incomeCents: 250000, essentialCents: 100000, flexibleCents: 50000, emergencyFundCents: 30000, savingsGoalsCents: 70000, unallocatedCents: 0 },
  emergencyFund: { targetMonths: 3, targetCents: 300000, currentBalanceCents: 100000, gapCents: 200000 },
  goalAllocations: [],
  categoryCaps: [],
  recommendations: [{ id: 'emergency-fund', priority: 1, title: 'Notgroschen', explanation: 'Aufbauen', aiExplanation: null, requiresApproval: true as const }],
  confidence: 0.7,
  dataQuality: { transactionCount: 20, monthsCovered: 3, level: 'medium' as const },
  limitations: [],
  ai: { source: 'deterministic-budget-engine' as const, model: null, confidence: 0.7, warnings: [] },
  learningProfile: profile,
  profileVersion: 1,
  privacy: { descriptionsSentToModel: false, accountNamesSentToModel: false, preciseLocationSentToModel: false, coarseLocationSentToModel: false, ipAddressPersisted: false, ipLocationLookupRequested: true, automaticMoneyMovement: false },
}

afterEach(() => vi.unstubAllGlobals())

describe('requestLearningBudgetPlan', () => {
  it('sends one-time IP-location consent without client-controlled location text', async () => {
    const fetchMock = vi.fn(async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body.consentBehaviorLearning).toBe(true)
      expect(body.consentLocationContext).toBe(true)
      expect(body).not.toHaveProperty('location')
      return { ok: true, json: async () => plan }
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await requestLearningBudgetPlan({
      consentBehaviorLearning: true,
      consentExternalAi: false,
      consentLocationContext: true,
      preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 60 },
    })
    expect(result.planId).toBe(plan.planId)
    expect(result.locationContext?.city).toBe('Karlsruhe')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('accepts a profile and plan without an IP-derived location', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ ...plan, locationContext: null, learningProfile: { ...profile, location: null } }),
    })))
    const result = await requestLearningBudgetPlan({
      consentBehaviorLearning: true,
      consentExternalAi: false,
      consentLocationContext: false,
      preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 60 },
    })
    expect(result.locationContext).toBeNull()
    expect(result.learningProfile.location).toBeNull()
  })

  it('rejects malformed budget responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ planId: 'missing-fields' }) })))
    await expect(requestLearningBudgetPlan({
      consentBehaviorLearning: true,
      consentExternalAi: false,
      consentLocationContext: false,
      preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 60 },
    })).rejects.toThrow(/ungültiges Ergebnis/)
  })
})

describe('submitBudgetFeedback', () => {
  it('stores only an explicit approved or rejected decision', async () => {
    const fetchMock = vi.fn(async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      expect(body).toEqual({ consentBehaviorLearning: true, planId: plan.planId, recommendationId: 'emergency-fund', decision: 'approved' })
      return { ok: true, json: async () => ({ profile: { ...profile, feedbackSummary: { 'emergency-fund': { approved: 1, rejected: 0, lastDecision: 'approved' } } } }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const updated = await submitBudgetFeedback(plan.planId, 'emergency-fund', 'approved')
    expect(updated.feedbackSummary['emergency-fund'].approved).toBe(1)
  })
})
