import { HttpError } from './runtime-security.js'

const MAX_EVENTS = 5000
const DAY_MS = 86_400_000

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, 'invalid_behavior_history', `${field} is invalid.`)
  return value
}

function parseDate(value, field) {
  const date = new Date(String(value || ''))
  if (!Number.isFinite(date.getTime())) throw new HttpError(400, 'invalid_behavior_history', `${field} is invalid.`)
  return date
}

export function validateBehaviorHistory(value) {
  if (!Array.isArray(value) || value.length > MAX_EVENTS) throw new HttpError(400, 'invalid_behavior_history', `events must contain at most ${MAX_EVENTS} entries.`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'invalid_behavior_history', `events[${index}] must be an object.`)
    const allowed = new Set(['date', 'amountCents', 'type', 'categoryRank', 'recurring'])
    for (const key of Object.keys(item)) if (!allowed.has(key)) throw new HttpError(400, 'invalid_behavior_history', `Unexpected events[${index}] field: ${key}`)
    if (!['income', 'expense'].includes(item.type)) throw new HttpError(400, 'invalid_behavior_history', `events[${index}].type is invalid.`)
    return {
      date: parseDate(item.date, `events[${index}].date`),
      amountCents: integer(item.amountCents, `events[${index}].amountCents`),
      type: item.type,
      categoryRank: integer(item.categoryRank ?? 0, `events[${index}].categoryRank`, { max: 100 }),
      recurring: item.recurring === true,
    }
  })
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function standardDeviation(values, average) {
  if (values.length < 2) return 0
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length)
}

export function learnBehaviorPatterns(events, now = new Date()) {
  const history = validateBehaviorHistory(events)
  const cutoff = now.getTime() - (120 * DAY_MS)
  const recent = history.filter((event) => event.date.getTime() >= cutoff)
  const expenses = recent.filter((event) => event.type === 'expense')
  const incomes = recent.filter((event) => event.type === 'income')
  const weeklyExpense = new Map()
  const weekdayExpense = Array.from({ length: 7 }, () => [])
  const categoryTotals = new Map()

  for (const event of expenses) {
    const week = Math.floor(event.date.getTime() / (7 * DAY_MS))
    weeklyExpense.set(week, (weeklyExpense.get(week) ?? 0) + event.amountCents)
    weekdayExpense[event.date.getUTCDay()].push(event.amountCents)
    categoryTotals.set(event.categoryRank, (categoryTotals.get(event.categoryRank) ?? 0) + event.amountCents)
  }

  const weeklyValues = [...weeklyExpense.values()]
  const averageWeeklyExpenseCents = Math.round(mean(weeklyValues))
  const volatilityCents = Math.round(standardDeviation(weeklyValues, averageWeeklyExpenseCents))
  const averageMonthlyIncomeCents = Math.round(mean(incomes.map((event) => event.amountCents)) * Math.max(1, incomes.length / 4))
  const predictedNextMonthExpenseCents = Math.round(averageWeeklyExpenseCents * 4.345)
  const predictedFreeCashCents = averageMonthlyIncomeCents - predictedNextMonthExpenseCents
  const strongestCategory = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]
  const weekday = weekdayExpense
    .map((values, day) => ({ day, averageCents: Math.round(mean(values)) }))
    .sort((a, b) => b.averageCents - a.averageCents)[0]

  const confidence = Math.max(0.2, Math.min(0.92, recent.length / 100))
  const signals = []
  if (predictedFreeCashCents < 0) signals.push({ type: 'cashflow', severity: 'warning', explanation: 'Learned recent spending patterns predict a negative monthly free cash flow.', requiresApproval: true })
  if (volatilityCents > averageWeeklyExpenseCents * 0.5) signals.push({ type: 'anomaly', severity: 'info', explanation: 'Weekly spending varies strongly, so predictions should be treated cautiously.', requiresApproval: true })

  return {
    generatedAt: now.toISOString(),
    sampleSize: recent.length,
    horizonDays: 30,
    confidence,
    predictions: {
      nextMonthExpenseCents: predictedNextMonthExpenseCents,
      nextMonthIncomeCents: averageMonthlyIncomeCents,
      freeCashCents: predictedFreeCashCents,
    },
    patterns: {
      strongestCategoryRank: strongestCategory?.[0] ?? null,
      highestSpendWeekday: weekday?.averageCents ? weekday.day : null,
      recurringExpenseShare: expenses.length ? expenses.filter((event) => event.recurring).length / expenses.length : 0,
      weeklyVolatilityCents: volatilityCents,
    },
    signals,
    privacy: {
      persistedByModule: false,
      rawDescriptionsUsed: false,
      userApprovalRequired: true,
    },
  }
}
