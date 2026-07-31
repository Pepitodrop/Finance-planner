import { HttpError } from './runtime-security.js'

const DAY_MS = 86_400_000
const MONTH_MS = 30.4375 * DAY_MS
const MAX_TRANSACTIONS = 30_000
const SAVINGS_STYLES = new Set(['conservative', 'balanced', 'ambitious'])
const COST_LEVELS = new Set(['unknown', 'low', 'medium', 'high'])

function safeInteger(value, field, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, 'invalid_budget_data', `${field} must be a safe integer.`)
  return value
}

function boundedText(value, field, maxLength, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === '')) return null
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_budget_preferences', `${field} must be a string.`)
  const text = value.trim()
  if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) throw new HttpError(400, 'invalid_budget_preferences', `${field} is invalid.`)
  return text
}

function asDate(value, field, now) {
  const date = new Date(String(value || ''))
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + DAY_MS) throw new HttpError(400, 'invalid_budget_data', `${field} is invalid.`)
  return date
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function standardDeviation(values, average) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length)
}

export function validateBudgetPreferences(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_budget_preferences', 'preferences must be an object.')
  if (Object.keys(value).some((key) => !['savingsStyle', 'emergencyFundMonths', 'sustainabilityPriority'].includes(key))) {
    throw new HttpError(400, 'invalid_budget_preferences', 'Unexpected budget preference field.')
  }
  const savingsStyle = String(value.savingsStyle || 'balanced')
  if (!SAVINGS_STYLES.has(savingsStyle)) throw new HttpError(400, 'invalid_budget_preferences', 'savingsStyle is invalid.')
  const emergencyFundMonths = value.emergencyFundMonths === undefined ? 3 : Number(value.emergencyFundMonths)
  if (!Number.isInteger(emergencyFundMonths) || emergencyFundMonths < 1 || emergencyFundMonths > 12) throw new HttpError(400, 'invalid_budget_preferences', 'emergencyFundMonths must be between 1 and 12.')
  const sustainabilityPriority = value.sustainabilityPriority === undefined ? 50 : Number(value.sustainabilityPriority)
  if (!Number.isInteger(sustainabilityPriority) || sustainabilityPriority < 0 || sustainabilityPriority > 100) throw new HttpError(400, 'invalid_budget_preferences', 'sustainabilityPriority must be between 0 and 100.')
  return { savingsStyle, emergencyFundMonths, sustainabilityPriority }
}

export function validateLocationContext(value = null) {
  if (value === null || value === undefined) return { country: 'DE', region: null, city: null, costLevel: 'unknown' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'invalid_budget_location', 'location must be an object.')
  if (Object.keys(value).some((key) => !['country', 'region', 'city', 'costLevel'].includes(key))) throw new HttpError(400, 'invalid_budget_location', 'Unexpected location field.')
  const country = String(value.country || 'DE').toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(400, 'invalid_budget_location', 'country must be a two-letter code.')
  const region = boundedText(value.region, 'location.region', 100, { nullable: true })
  const city = boundedText(value.city, 'location.city', 100, { nullable: true })
  const costLevel = String(value.costLevel || 'unknown')
  if (!COST_LEVELS.has(costLevel)) throw new HttpError(400, 'invalid_budget_location', 'costLevel is invalid.')
  return { country, region, city, costLevel }
}

export function behaviorEventsFromFinanceState(state, now = new Date()) {
  const transactions = Array.isArray(state?.transactions) ? state.transactions : []
  if (transactions.length > MAX_TRANSACTIONS) throw new HttpError(400, 'invalid_budget_data', `transactions must contain at most ${MAX_TRANSACTIONS} entries.`)
  const expenseTotals = new Map()
  for (const transaction of transactions) {
    if (transaction?.type !== 'expense') continue
    const category = String(transaction.category || '').trim()
    if (category) expenseTotals.set(category, (expenseTotals.get(category) ?? 0) + Number(transaction.amountCents || 0))
  }
  const categoryRanks = new Map([...expenseTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 100).map(([category], index) => [category, index + 1]))
  return transactions.map((transaction, index) => {
    const type = transaction?.type
    if (!['income', 'expense'].includes(type)) throw new HttpError(400, 'invalid_budget_data', `transactions[${index}].type is invalid.`)
    return {
      date: asDate(transaction.date, `transactions[${index}].date`, now).toISOString(),
      amountCents: safeInteger(transaction.amountCents, `transactions[${index}].amountCents`, { min: 1 }),
      type,
      categoryRank: type === 'expense' ? (categoryRanks.get(String(transaction.category || '').trim()) ?? 0) : 0,
      recurring: transaction.recurring === true,
    }
  }).sort((a, b) => a.date.localeCompare(b.date)).slice(-5000)
}

export function buildBudgetSnapshot(state, now = new Date()) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new HttpError(400, 'invalid_budget_data', 'Finance state is unavailable.')
  const transactions = Array.isArray(state.transactions) ? state.transactions : []
  const accounts = Array.isArray(state.accounts) ? state.accounts : []
  const goals = Array.isArray(state.goals) ? state.goals : []
  if (transactions.length > MAX_TRANSACTIONS) throw new HttpError(400, 'invalid_budget_data', `transactions must contain at most ${MAX_TRANSACTIONS} entries.`)

  const cutoff = now.getTime() - (365 * DAY_MS)
  const normalized = transactions.map((transaction, index) => ({
    date: asDate(transaction.date, `transactions[${index}].date`, now),
    amountCents: safeInteger(transaction.amountCents, `transactions[${index}].amountCents`, { min: 1 }),
    type: transaction.type,
    category: boundedText(transaction.category, `transactions[${index}].category`, 80),
    recurring: transaction.recurring === true,
  })).filter((transaction) => transaction.date.getTime() >= cutoff && ['income', 'expense'].includes(transaction.type))

  const months = new Set(normalized.map((transaction) => monthKey(transaction.date)))
  const monthsCovered = Math.max(1, months.size || 1)
  const totalIncomeCents = normalized.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amountCents, 0)
  const totalExpenseCents = normalized.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
  const recurringExpenseCents = normalized.filter((item) => item.type === 'expense' && item.recurring).reduce((sum, item) => sum + item.amountCents, 0)
  const monthlyIncomeCents = Math.round(totalIncomeCents / monthsCovered)
  const monthlyExpenseCents = Math.round(totalExpenseCents / monthsCovered)
  const monthlyRecurringCents = Math.round(recurringExpenseCents / monthsCovered)
  const monthlyFreeCashCents = monthlyIncomeCents - monthlyExpenseCents
  const accountBalanceCents = accounts.reduce((sum, account, index) => sum + safeInteger(account.balanceCents, `accounts[${index}].balanceCents`), 0)
  const liquidBalanceCents = accounts.reduce((sum, account, index) => {
    const balance = safeInteger(account.balanceCents, `accounts[${index}].balanceCents`)
    return ['checking', 'savings', 'cash'].includes(account.type) ? sum + balance : sum
  }, 0)

  const categoryTotals = new Map()
  for (const item of normalized) if (item.type === 'expense') categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.amountCents)
  const categories = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, totalCents]) => ({ name, monthlyAverageCents: Math.round(totalCents / monthsCovered) }))

  const weekly = new Map()
  for (const item of normalized) if (item.type === 'expense') {
    const week = Math.floor(item.date.getTime() / (7 * DAY_MS))
    weekly.set(week, (weekly.get(week) ?? 0) + item.amountCents)
  }
  const weeklyValues = [...weekly.values()]
  const averageWeeklyExpenseCents = Math.round(mean(weeklyValues))
  const weeklyVolatilityCents = Math.round(standardDeviation(weeklyValues, averageWeeklyExpenseCents))

  const normalizedGoals = goals.slice(0, 20).map((goal, index) => {
    const targetCents = safeInteger(goal.targetCents, `goals[${index}].targetCents`, { min: 1 })
    const currentCents = safeInteger(goal.currentCents, `goals[${index}].currentCents`, { min: 0 })
    const targetDate = asDate(goal.targetDate, `goals[${index}].targetDate`, new Date('9999-12-31T00:00:00Z'))
    const remainingCents = Math.max(0, targetCents - currentCents)
    const monthsRemaining = Math.max(1, Math.ceil((targetDate.getTime() - now.getTime()) / MONTH_MS))
    return {
      id: boundedText(goal.id, `goals[${index}].id`, 128),
      name: boundedText(goal.name, `goals[${index}].name`, 160),
      targetDate: targetDate.toISOString().slice(0, 10),
      remainingCents,
      monthsRemaining,
      monthlyRequiredCents: Math.ceil(remainingCents / monthsRemaining),
    }
  })

  return {
    generatedAt: now.toISOString(),
    transactionCount: normalized.length,
    monthsCovered,
    monthlyIncomeCents,
    monthlyExpenseCents,
    monthlyRecurringCents,
    monthlyFreeCashCents,
    accountBalanceCents,
    liquidBalanceCents,
    categories,
    goals: normalizedGoals,
    averageWeeklyExpenseCents,
    weeklyVolatilityCents,
  }
}

function feedbackScore(feedback, recommendationId) {
  const item = feedback?.[recommendationId]
  if (!item) return 0
  return Number(item.approved || 0) - Number(item.rejected || 0)
}

export function updateLearningProfile(existing, snapshot, input, now = new Date()) {
  const preferences = validateBudgetPreferences(input.preferences)
  const location = validateLocationContext(input.location)
  const feedback = existing?.feedback && typeof existing.feedback === 'object' && !Array.isArray(existing.feedback) ? existing.feedback : {}
  const categoryPreferences = snapshot.categories.slice(0, 8).map((category, index) => ({
    category: category.name,
    monthlyAverageCents: category.monthlyAverageCents,
    weight: Number(Math.max(0.1, 1 - (index * 0.1)).toFixed(2)),
  }))
  const dataScore = Math.min(1, snapshot.transactionCount / 100)
  const historyScore = Math.min(1, snapshot.monthsCovered / 6)
  const feedbackCount = Object.values(feedback).reduce((sum, item) => sum + Number(item?.approved || 0) + Number(item?.rejected || 0), 0)
  const feedbackConfidence = Math.min(1, feedbackCount / 20)
  const confidence = Number(((dataScore * 0.45) + (historyScore * 0.4) + (feedbackConfidence * 0.15)).toFixed(2))
  return {
    version: 1,
    enabled: true,
    preferences,
    location,
    feedback,
    patterns: {
      categoryPreferences,
      monthlyIncomeCents: snapshot.monthlyIncomeCents,
      monthlyExpenseCents: snapshot.monthlyExpenseCents,
      monthlyRecurringCents: snapshot.monthlyRecurringCents,
      savingsCapacityCents: Math.max(0, snapshot.monthlyFreeCashCents),
      volatilityCents: snapshot.weeklyVolatilityCents,
      goalCount: snapshot.goals.length,
    },
    confidence,
    learnedFromTransactions: snapshot.transactionCount,
    firstLearnedAt: existing?.firstLearnedAt || now.toISOString(),
    lastLearnedAt: now.toISOString(),
    privacy: {
      rawDescriptionsPersisted: false,
      preciseCoordinatesPersisted: false,
      externalInferenceRequiresConsent: true,
      userCanReset: true,
    },
  }
}

export function applyBudgetFeedback(profile, planId, recommendationId, decision, now = new Date()) {
  if (!profile || typeof profile !== 'object') throw new HttpError(409, 'budget_profile_missing', 'Create a budget plan before submitting feedback.')
  if (!/^budget-\d{4}-\d{2}-\d{2}-\d+-\d+$/.test(String(planId || ''))) throw new HttpError(400, 'invalid_budget_feedback', 'planId is invalid.')
  if (!/^[a-z0-9-]{3,64}$/.test(String(recommendationId || ''))) throw new HttpError(400, 'invalid_budget_feedback', 'recommendationId is invalid.')
  if (!['approved', 'rejected'].includes(decision)) throw new HttpError(400, 'invalid_budget_feedback', 'decision is invalid.')
  const feedback = { ...(profile.feedback || {}) }
  const current = feedback[recommendationId] || { approved: 0, rejected: 0, lastDecision: null, lastPlanId: null, updatedAt: null }
  const samePlan = current.lastPlanId === planId
  if (samePlan && current.lastDecision === decision) return profile
  const approved = Math.max(0, Number(current.approved || 0) - (samePlan && current.lastDecision === 'approved' ? 1 : 0))
    + (decision === 'approved' ? 1 : 0)
  const rejected = Math.max(0, Number(current.rejected || 0) - (samePlan && current.lastDecision === 'rejected' ? 1 : 0))
    + (decision === 'rejected' ? 1 : 0)
  feedback[recommendationId] = { approved, rejected, lastDecision: decision, lastPlanId: planId, updatedAt: now.toISOString() }
  return { ...profile, feedback, lastLearnedAt: now.toISOString() }
}

export function createDeterministicBudgetPlan(snapshot, profile, now = new Date()) {
  const styleFactor = profile.preferences.savingsStyle === 'ambitious' ? 0.88 : profile.preferences.savingsStyle === 'conservative' ? 0.58 : 0.72
  const costAdjustment = profile.location.costLevel === 'high' ? 0.9 : profile.location.costLevel === 'low' ? 1.05 : 1
  const nonRecurringCents = Math.max(0, snapshot.monthlyExpenseCents - snapshot.monthlyRecurringCents)
  const essentialCents = Math.min(snapshot.monthlyExpenseCents, snapshot.monthlyRecurringCents + Math.round(nonRecurringCents * 0.55))
  const emergencyTargetCents = essentialCents * profile.preferences.emergencyFundMonths
  const emergencyGapCents = Math.max(0, emergencyTargetCents - Math.max(0, snapshot.liquidBalanceCents))
  const positiveFreeCashCents = Math.max(0, snapshot.monthlyFreeCashCents)
  const emergencyContributionCents = emergencyGapCents > 0
    ? Math.min(Math.round(positiveFreeCashCents * 0.35), Math.ceil(emergencyGapCents / 12))
    : Math.round(positiveFreeCashCents * 0.1)
  const goalPoolCents = Math.max(0, Math.round((positiveFreeCashCents - emergencyContributionCents) * styleFactor * costAdjustment))
  const flexibleCents = Math.max(0, snapshot.monthlyIncomeCents - essentialCents - emergencyContributionCents - goalPoolCents)

  const goalWeights = snapshot.goals.map((goal) => ({
    ...goal,
    weight: goal.remainingCents === 0 ? 0 : Math.max(0.1, (1 / goal.monthsRemaining) * Math.log10(goal.remainingCents + 10)),
  }))
  const totalWeight = goalWeights.reduce((sum, goal) => sum + goal.weight, 0)
  const goalAllocations = goalWeights.map((goal) => ({
    goalId: goal.id,
    name: goal.name,
    targetDate: goal.targetDate,
    remainingCents: goal.remainingCents,
    recommendedMonthlyCents: goal.weight === 0 || totalWeight === 0 ? 0 : Math.min(goal.remainingCents, Math.round(goalPoolCents * (goal.weight / totalWeight))),
    requiredMonthlyCents: goal.monthlyRequiredCents,
    onTrack: goal.monthlyRequiredCents === 0 || (goal.weight > 0 && Math.round(goalPoolCents * (goal.weight / totalWeight)) >= goal.monthlyRequiredCents),
  }))

  const categoryCaps = snapshot.categories.slice(0, 8).map((category, index) => {
    const protectedCategory = index < 2 || category.monthlyAverageCents <= snapshot.monthlyRecurringCents * 0.25
    const feedbackBias = feedbackScore(profile.feedback, 'reduce-flexible-spending')
    const reduction = protectedCategory ? 0 : Math.min(0.15, 0.05 + Math.max(0, feedbackBias) * 0.01)
    return {
      category: category.name,
      historicalMonthlyCents: category.monthlyAverageCents,
      recommendedCapCents: Math.max(0, Math.round(category.monthlyAverageCents * (1 - reduction))),
      rationale: protectedCategory ? 'Historischer Richtwert; keine pauschale Kürzung ohne Bestätigung.' : 'Vorsichtiger Richtwert für flexible Ausgaben, basierend auf deinem Verlauf.',
    }
  })

  const recommendations = []
  recommendations.push({
    id: 'emergency-fund',
    priority: emergencyGapCents > 0 ? 1 : 4,
    title: emergencyGapCents > 0 ? 'Notgroschen systematisch aufbauen' : 'Notgroschen erhalten',
    explanation: emergencyGapCents > 0
      ? `Der Plan reserviert monatlich ${emergencyContributionCents} Cent, bis der Zielpuffer erreicht ist.`
      : 'Der vorhandene Puffer deckt das gewählte Ziel bereits ab; eine kleine Erhaltungsrate bleibt eingeplant.',
    requiresApproval: true,
  })
  if (snapshot.goals.length) recommendations.push({
    id: 'goal-allocation', priority: 2, title: 'Sparrate nach Zielterminen verteilen',
    explanation: 'Die monatliche Sparsumme wird nach Dringlichkeit und verbleibendem Zielbetrag verteilt.', requiresApproval: true,
  })
  if (snapshot.monthlyRecurringCents > snapshot.monthlyIncomeCents * 0.45) recommendations.push({
    id: 'review-recurring-costs', priority: 2, title: 'Feste Kosten einzeln prüfen',
    explanation: 'Der Anteil wiederkehrender Ausgaben ist hoch. Verträge sollten einzeln bestätigt, nicht automatisch gekündigt werden.', requiresApproval: true,
  })
  if (snapshot.weeklyVolatilityCents > snapshot.averageWeeklyExpenseCents * 0.5) recommendations.push({
    id: 'smooth-spending', priority: 3, title: 'Schwankende Wochen glätten',
    explanation: 'Ein wöchentliches flexibles Limit kann starke Ausgabenspitzen reduzieren.', requiresApproval: true,
  })
  recommendations.push({
    id: 'reduce-flexible-spending', priority: 4, title: 'Flexible Kategorien mit Limits versehen',
    explanation: 'Die vorgeschlagenen Limits sind Ausgangswerte und werden durch deine Bestätigungen oder Ablehnungen angepasst.', requiresApproval: true,
  })
  if (profile.preferences.sustainabilityPriority >= 60) recommendations.push({
    id: 'sustainable-budget', priority: 4, title: 'Nachhaltigkeit im flexiblen Budget priorisieren',
    explanation: 'Bei vergleichbaren Optionen soll der Plan BIO, Fairtrade, regionale, saisonale und verpackungsarme Alternativen bevorzugen, ohne aktuelle Preise oder Verfügbarkeit zu behaupten.', requiresApproval: true,
  })
  if (profile.location.city || profile.location.region) recommendations.push({
    id: 'location-context', priority: 5, title: 'Standort als Kontext berücksichtigen',
    explanation: 'Der Standort wird nur grob verwendet. Es gibt keine Live-Abfrage lokaler Preise, Mieten oder Angebote.', requiresApproval: true,
  })

  recommendations.sort((a, b) => a.priority - b.priority)
  const planId = `budget-${now.toISOString().slice(0, 10)}-${snapshot.transactionCount}-${snapshot.monthsCovered}`
  return {
    planId,
    period: 'monthly',
    generatedAt: now.toISOString(),
    allocations: {
      incomeCents: snapshot.monthlyIncomeCents,
      essentialCents,
      flexibleCents,
      emergencyFundCents: emergencyContributionCents,
      savingsGoalsCents: goalPoolCents,
      unallocatedCents: Math.max(0, snapshot.monthlyIncomeCents - essentialCents - flexibleCents - emergencyContributionCents - goalPoolCents),
    },
    emergencyFund: {
      targetMonths: profile.preferences.emergencyFundMonths,
      targetCents: emergencyTargetCents,
      currentBalanceCents: snapshot.liquidBalanceCents,
      gapCents: emergencyGapCents,
    },
    goalAllocations,
    categoryCaps,
    recommendations,
    confidence: profile.confidence,
    dataQuality: {
      transactionCount: snapshot.transactionCount,
      monthsCovered: snapshot.monthsCovered,
      level: profile.confidence >= 0.75 ? 'high' : profile.confidence >= 0.45 ? 'medium' : 'low',
    },
    limitations: [
      'Der Plan verwendet historische Transaktionen und bestätigte Präferenzen; er ist keine Garantie für zukünftige Ausgaben.',
      'Standortangaben sind grob und werden nicht mit Live-Preis-, Miet- oder Angebotsdaten abgeglichen.',
      'Keine Zahlung, Budgetänderung oder Vertragskündigung wird automatisch ausgeführt.',
    ],
  }
}

export function publicLearningProfile(profile) {
  if (!profile) return null
  return {
    enabled: profile.enabled === true,
    preferences: profile.preferences,
    location: profile.location,
    patterns: profile.patterns,
    confidence: profile.confidence,
    learnedFromTransactions: profile.learnedFromTransactions,
    firstLearnedAt: profile.firstLearnedAt,
    lastLearnedAt: profile.lastLearnedAt,
    feedbackSummary: Object.fromEntries(Object.entries(profile.feedback || {}).map(([id, item]) => [id, {
      approved: Number(item?.approved || 0),
      rejected: Number(item?.rejected || 0),
      lastDecision: item?.lastDecision || null,
    }])),
    privacy: profile.privacy,
  }
}
