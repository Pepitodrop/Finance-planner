export type SavingsStyle = 'conservative' | 'balanced' | 'ambitious'
export type CostLevel = 'unknown' | 'low' | 'medium' | 'high'
export type BudgetDecision = 'approved' | 'rejected'

export interface CoarseLocation {
  country: string
  region: string | null
  city: string | null
  costLevel: CostLevel
}

export interface BudgetProfile {
  enabled: boolean
  preferences: { savingsStyle: SavingsStyle; emergencyFundMonths: number; sustainabilityPriority: number }
  location: CoarseLocation | null
  patterns: {
    categoryPreferences: Array<{ category: string; monthlyAverageCents: number; weight: number }>
    monthlyIncomeCents: number
    monthlyExpenseCents: number
    monthlyRecurringCents: number
    savingsCapacityCents: number
    volatilityCents: number
    goalCount: number
  }
  confidence: number
  learnedFromTransactions: number
  firstLearnedAt: string
  lastLearnedAt: string
  feedbackSummary: Record<string, { approved: number; rejected: number; lastDecision: BudgetDecision | null }>
  privacy: {
    rawDescriptionsPersisted: boolean
    preciseCoordinatesPersisted: boolean
    externalInferenceRequiresConsent: boolean
    userCanReset: boolean
  }
}

export interface BudgetRecommendation {
  id: string
  priority: number
  title: string
  explanation: string
  aiExplanation: string | null
  requiresApproval: true
}

export interface BudgetPlan {
  planId: string
  period: 'monthly'
  generatedAt: string
  cashflowStatus: 'balanced' | 'deficit'
  monthlyDeficitCents: number
  summary: string
  locationContext: CoarseLocation | null
  allocations: {
    incomeCents: number
    essentialCents: number
    flexibleCents: number
    emergencyFundCents: number
    savingsGoalsCents: number
    unallocatedCents: number
  }
  emergencyFund: { targetMonths: number; targetCents: number; currentBalanceCents: number; gapCents: number }
  goalAllocations: Array<{
    goalId: string
    name: string
    targetDate: string
    remainingCents: number
    recommendedMonthlyCents: number
    requiredMonthlyCents: number
    onTrack: boolean
  }>
  categoryCaps: Array<{ category: string; historicalMonthlyCents: number; recommendedCapCents: number; rationale: string }>
  recommendations: BudgetRecommendation[]
  confidence: number
  dataQuality: { transactionCount: number; monthsCovered: number; level: 'low' | 'medium' | 'high' }
  limitations: string[]
  ai: {
    source: 'deterministic-budget-engine' | 'hugging-face-budget-explanation'
    model: { id: string; license: string; routing: string } | null
    confidence: number
    warnings: string[]
  }
  learningProfile: BudgetProfile
  profileVersion: number
  privacy: {
    descriptionsSentToModel: boolean
    accountNamesSentToModel: boolean
    preciseLocationSentToModel: boolean
    coarseLocationSentToModel: boolean
    ipAddressPersisted: boolean
    ipLocationLookupRequested: boolean
    automaticMoneyMovement: boolean
  }
}

export interface BudgetPlanRequest {
  consentBehaviorLearning: boolean
  consentExternalAi: boolean
  consentLocationContext: boolean
  preferences: { savingsStyle: SavingsStyle; emergencyFundMonths: number; sustainabilityPriority: number }
}

function errorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message
  return fallback
}

function isCoarseLocation(value: unknown): value is CoarseLocation {
  if (typeof value !== 'object' || value === null) return false
  const location = value as Partial<CoarseLocation>
  return typeof location.country === 'string'
    && (location.region === null || typeof location.region === 'string')
    && (location.city === null || typeof location.city === 'string')
    && ['unknown', 'low', 'medium', 'high'].includes(String(location.costLevel))
}

function isBudgetProfile(value: unknown): value is BudgetProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Partial<BudgetProfile>
  const validLocation = profile.location === null || isCoarseLocation(profile.location)
  return profile.enabled === true
    && typeof profile.preferences === 'object'
    && validLocation
    && typeof profile.patterns === 'object'
    && typeof profile.confidence === 'number'
    && typeof profile.learnedFromTransactions === 'number'
    && typeof profile.privacy === 'object'
}

function isBudgetPlan(value: unknown): value is BudgetPlan {
  if (typeof value !== 'object' || value === null) return false
  const plan = value as Partial<BudgetPlan>
  const validLocation = plan.locationContext === null || isCoarseLocation(plan.locationContext)
  return typeof plan.planId === 'string'
    && /^budget-\d{4}-\d{2}-\d{2}-[0-9a-f-]{36}$/i.test(plan.planId)
    && typeof plan.summary === 'string'
    && validLocation
    && (plan.cashflowStatus === 'balanced' || plan.cashflowStatus === 'deficit')
    && typeof plan.monthlyDeficitCents === 'number'
    && typeof plan.allocations === 'object'
    && Array.isArray(plan.recommendations)
    && Array.isArray(plan.goalAllocations)
    && Array.isArray(plan.categoryCaps)
    && Array.isArray(plan.limitations)
    && isBudgetProfile(plan.learningProfile)
}

async function jsonRequest(path: string, init: RequestInit, timeoutMs = 60_000): Promise<unknown> {
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(path, { ...init, credentials: 'include', signal: controller.signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(errorMessage(payload, 'The learning budget service is currently unreachable.'))
    return payload
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export async function requestLearningBudgetPlan(input: BudgetPlanRequest): Promise<BudgetPlan> {
  const payload = await jsonRequest('/api/ai/budget-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!isBudgetPlan(payload)) throw new Error('The budget service returned an invalid result.')
  return payload
}

export async function loadLearningBudgetProfile(): Promise<BudgetProfile | null> {
  const payload = await jsonRequest('/api/ai/budget-profile', { method: 'GET' }, 15_000)
  if (typeof payload !== 'object' || payload === null) throw new Error('The learning profile could not be read.')
  const profile = (payload as { profile?: unknown }).profile
  if (profile === null || profile === undefined) return null
  if (!isBudgetProfile(profile)) throw new Error('The stored learning profile is invalid.')
  return profile
}

export async function submitBudgetFeedback(planId: string, recommendationId: string, decision: BudgetDecision): Promise<BudgetProfile> {
  const payload = await jsonRequest('/api/ai/budget-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ consentBehaviorLearning: true, planId, recommendationId, decision }),
  }, 15_000)
  if (typeof payload !== 'object' || payload === null || !isBudgetProfile((payload as { profile?: unknown }).profile)) {
    throw new Error('The feedback could not be saved securely.')
  }
  return (payload as { profile: BudgetProfile }).profile
}

export async function resetLearningBudgetProfile(): Promise<void> {
  await jsonRequest('/api/ai/budget-profile', { method: 'DELETE' }, 15_000)
}
