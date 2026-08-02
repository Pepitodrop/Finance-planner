import { HttpError } from './runtime-security.js'
import { calibrateIntelligenceQuality, robustWeeklyTrend } from './intelligence-quality.js'

const MAX_EVENTS = 5000
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
const LOOKBACK_DAYS = 180
const MIN_PREDICTION_EVENTS = 8
const MIN_ACTIVE_WEEKS = 4

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, 'invalid_behavior_history', `${field} is invalid.`)
  return value
}

function parseDate(value, field, now) {
  const date = new Date(String(value || ''))
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'invalid_behavior_history', `${field} is invalid.`)
  if (date.getTime() > now.getTime()) throw new HttpError(400, 'invalid_behavior_history', `${field} must not be in the future.`)
  return date
}

export function validateBehaviorHistory(value, now = new Date()) {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) throw new HttpError(400, 'invalid_behavior_history', `events must contain at most ${MAX_EVENTS} entries.`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'invalid_behavior_history', `events[${index}] must be an object.`)
    const allowed = new Set(['date', 'amountCents', 'type', 'categoryRank', 'recurring'])
    for (const key of Object.keys(item)) if (!allowed.has(key)) throw new HttpError(400, 'invalid_behavior_history', `Unexpected events[${index}] field: ${key}`)
    if (!['income', 'expense'].includes(item.type)) throw new HttpError(400, 'invalid_behavior_history', `events[${index}].type is invalid.`)
    return {
      date: parseDate(item.date, `events[${index}].date`, now),
      amountCents: integer(item.amountCents, `events[${index}].amountCents`),
      type: item.type,
      categoryRank: integer(item.categoryRank ?? 0, `events[${index}].categoryRank`, { max: 100 }),
      recurring: item.recurring === true,
    }
  })
}

function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 }
function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
function standardDeviation(values, average = mean(values)) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length)
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }
function weightedMean(items) {
  const weight = items.reduce((sum, item) => sum + item.weight, 0)
  return weight ? items.reduce((sum, item) => sum + item.value * item.weight, 0) / weight : 0
}
function monthKey(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` }

export function learnBehaviorPatterns(events, now = new Date()) {
  const history = validateBehaviorHistory(events, now)
  const cutoff = now.getTime() - (LOOKBACK_DAYS * DAY_MS)
  const recent = history.filter((event) => event.date.getTime() >= cutoff)
  const expenses = recent.filter((event) => event.type === 'expense')
  const incomes = recent.filter((event) => event.type === 'income')
  const weeklyExpense = new Map()
  const monthlyIncome = new Map()
  const weekdayExpense = Array.from({ length: 7 }, () => [])
  const categoryTotals = new Map()

  for (const event of expenses) {
    const week = Math.floor(event.date.getTime() / WEEK_MS)
    weeklyExpense.set(week, (weeklyExpense.get(week) ?? 0) + event.amountCents)
    weekdayExpense[event.date.getUTCDay()].push(event.amountCents)
    categoryTotals.set(event.categoryRank, (categoryTotals.get(event.categoryRank) ?? 0) + event.amountCents)
  }
  for (const event of incomes) monthlyIncome.set(monthKey(event.date), (monthlyIncome.get(monthKey(event.date)) ?? 0) + event.amountCents)

  const weeklyEntries = [...weeklyExpense.entries()].sort((a, b) => a[0] - b[0])
  const weeklyValues = weeklyEntries.map(([, value]) => value)
  const recentWeightedWeeks = weeklyEntries.map(([week, value], index) => ({ value, weight: 1 + index / Math.max(1, weeklyEntries.length - 1) }))
  const averageWeeklyExpenseCents = Math.round(weightedMean(recentWeightedWeeks))
  const volatilityCents = Math.round(standardDeviation(weeklyValues))
  const medianWeekly = median(weeklyValues)
  const mad = median(weeklyValues.map((value) => Math.abs(value - medianWeekly)))
  const monthlyIncomeValues = [...monthlyIncome.values()]
  const averageMonthlyIncomeCents = Math.round(mean(monthlyIncomeValues))
  const predictedNextMonthExpenseCents = Math.round(averageWeeklyExpenseCents * 4.345)
  const predictedFreeCashCents = averageMonthlyIncomeCents - predictedNextMonthExpenseCents
  const uncertaintyCents = Math.round(Math.max(volatilityCents * 4.345, predictedNextMonthExpenseCents * 0.08))
  const strongestCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]
  const weekday = weekdayExpense.map((values, day) => ({ day, averageCents: Math.round(mean(values)) })).sort((a, b) => b.averageCents - a.averageCents)[0]

  const activeWeeks = weeklyValues.length
  const coverage = clamp(activeWeeks / 12, 0, 1)
  const sampleScore = clamp(recent.length / 80, 0, 1)
  const stabilityScore = predictedNextMonthExpenseCents ? clamp(1 - (uncertaintyCents / Math.max(1, predictedNextMonthExpenseCents)), 0, 1) : 0
  const rawConfidence = Number(clamp(0.15 + 0.35 * coverage + 0.3 * sampleScore + 0.2 * stabilityScore, 0.15, 0.95).toFixed(3))
  const recurringClassified = expenses.filter((event) => event.recurring).length
  const recurringCoverage = expenses.length ? clamp((recurringClassified + Math.min(expenses.length - recurringClassified, 12)) / Math.max(1, expenses.length), 0, 1) : 0
  const latestEventAt = recent.reduce((latest, event) => !latest || event.date > latest ? event.date : latest, null)?.toISOString()
  const calibration = calibrateIntelligenceQuality({
    baseConfidence: rawConfidence,
    coverage,
    sampleScore,
    stabilityScore,
    recurringCoverage,
    providerCompleteness: 1,
    latestEventAt,
    now,
  })
  const insufficientData = recent.length < MIN_PREDICTION_EVENTS || activeWeeks < MIN_ACTIVE_WEEKS || calibration.abstain
  const signals = []

  if (insufficientData) signals.push({ type: 'insufficient-data', severity: 'info', explanation: 'Not enough recent and reliable history exists for a forward-looking estimate.', requiresApproval: false })
  if (!insufficientData && predictedFreeCashCents < 0) signals.push({ type: 'cashflow', severity: 'warning', explanation: 'Recent spending patterns predict a negative monthly free cash flow.', requiresApproval: true })
  if (weeklyValues.length >= 6 && mad > 0) {
    const newest = weeklyValues.at(-1)
    const robustZ = Math.abs(newest - medianWeekly) / (1.4826 * mad)
    if (robustZ >= 3.5) signals.push({ type: 'anomaly', severity: 'warning', explanation: 'The latest weekly spending is a statistically unusual deviation from the recent pattern.', requiresApproval: true })
  }
  if (volatilityCents > averageWeeklyExpenseCents * 0.5) signals.push({ type: 'volatility', severity: 'info', explanation: 'Weekly spending varies strongly, widening the forecast range.', requiresApproval: false })

  const recurringExpenseCents = expenses.filter((event) => event.recurring).reduce((sum, event) => sum + event.amountCents, 0)
  const totalExpenseCents = expenses.reduce((sum, event) => sum + event.amountCents, 0)
  const trend = robustWeeklyTrend(weeklyValues)

  return {
    generatedAt: now.toISOString(),
    sampleSize: recent.length,
    horizonDays: 30,
    confidence: calibration.calibratedConfidence,
    abstained: insufficientData,
    abstentionReason: insufficientData ? calibration.reasons[0] || 'insufficient_recent_history' : null,
    predictions: insufficientData ? null : {
      nextMonthExpenseCents: predictedNextMonthExpenseCents,
      nextMonthIncomeCents: averageMonthlyIncomeCents,
      freeCashCents: predictedFreeCashCents,
      expenseRangeCents: {
        low: Math.max(0, predictedNextMonthExpenseCents - uncertaintyCents),
        high: predictedNextMonthExpenseCents + uncertaintyCents,
      },
    },
    patterns: {
      strongestCategoryRank: strongestCategory?.[0] ?? null,
      highestSpendWeekday: weekday?.averageCents ? weekday.day : null,
      recurringExpenseShare: totalExpenseCents ? recurringExpenseCents / totalExpenseCents : 0,
      weeklyVolatilityCents: volatilityCents,
      weeklyTrend: trend,
      activeWeeks,
    },
    signals,
    quality: {
      coverage,
      sampleScore,
      stabilityScore,
      recurringCoverage,
      rawConfidence,
      calibration,
      lookbackDays: LOOKBACK_DAYS,
      method: 'recency-weighted-robust-forecast-v3-calibrated',
    },
    privacy: { persistedByModule: false, rawDescriptionsUsed: false, userApprovalRequired: true, trustedServerHistoryRequired: true },
  }
}
