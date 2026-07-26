import type { Transaction } from './types'

export type RecurringCadence = 'weekly' | 'monthly' | 'yearly' | 'manual'

export interface RecurringCandidate {
  transaction: Transaction
  cadence: RecurringCadence
  confidence: number
  occurrences: number
}

const DAY_MS = 86_400_000

function normalizedMerchant(description: string): string {
  return description
    .toLocaleLowerCase('de-DE')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(?:sepa|lastschrift|kartenzahlung|paypal|zahlung|rechnung|ref|mandat|iban)\b/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dateValue(date: string): number {
  const parsed = Date.parse(`${date.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

function cadenceForGap(days: number): RecurringCadence | null {
  if (days >= 5 && days <= 9) return 'weekly'
  if (days >= 25 && days <= 35) return 'monthly'
  if (days >= 350 && days <= 380) return 'yearly'
  return null
}

function monthlyAmount(amountCents: number, cadence: RecurringCadence): number {
  if (cadence === 'weekly') return Math.round(amountCents * 52 / 12)
  if (cadence === 'yearly') return Math.round(amountCents / 12)
  return amountCents
}

function amountConsistency(amounts: number[]): number {
  const typical = median(amounts)
  if (typical <= 0) return 0
  const tolerance = Math.max(100, Math.round(typical * 0.08))
  const matching = amounts.filter((amount) => Math.abs(amount - typical) <= tolerance).length
  return matching / amounts.length
}

function inferredCandidates(group: Transaction[]): RecurringCandidate[] {
  if (group.length < 3) return []
  const ordered = [...group].sort((a, b) => a.date.localeCompare(b.date))
  const timestamps = ordered.map((transaction) => dateValue(transaction.date))
  if (timestamps.some(Number.isNaN)) return []

  const gaps = timestamps.slice(1).map((value, index) => Math.round((value - timestamps[index]) / DAY_MS))
  const cadenceVotes = gaps.map(cadenceForGap).filter((value): value is RecurringCadence => value !== null)
  if (!cadenceVotes.length) return []

  const cadenceCounts = new Map<RecurringCadence, number>()
  cadenceVotes.forEach((cadence) => cadenceCounts.set(cadence, (cadenceCounts.get(cadence) ?? 0) + 1))
  const [cadence, matchingGaps] = [...cadenceCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const intervalConsistency = matchingGaps / gaps.length
  const amountScore = amountConsistency(ordered.map((transaction) => transaction.amountCents))
  if (intervalConsistency < 0.67 || amountScore < 0.67) return []

  const latest = ordered.at(-1)!
  const typicalAmount = median(ordered.map((transaction) => transaction.amountCents))
  const confidence = Math.min(99, Math.round((intervalConsistency * 0.55 + amountScore * 0.35 + Math.min(ordered.length, 6) / 60) * 100))

  return [{
    transaction: {
      ...latest,
      id: `recurring:${normalizedMerchant(latest.description)}:${cadence}`,
      amountCents: monthlyAmount(typicalAmount, cadence),
      recurring: true,
    },
    cadence,
    confidence,
    occurrences: ordered.length,
  }]
}

export function detectRecurringPayments(transactions: Transaction[]): RecurringCandidate[] {
  const expenses = transactions.filter((transaction) => transaction.type === 'expense' && transaction.amountCents > 0)
  const manual = expenses
    .filter((transaction) => transaction.recurring)
    .map((transaction): RecurringCandidate => ({ transaction, cadence: 'manual', confidence: 100, occurrences: 1 }))

  const manuallyCovered = new Set(manual.map((item) => normalizedMerchant(item.transaction.description)))
  const groups = new Map<string, Transaction[]>()
  for (const transaction of expenses) {
    const merchant = normalizedMerchant(transaction.description)
    if (!merchant || manuallyCovered.has(merchant)) continue
    const key = `${transaction.accountId}:${merchant}`
    groups.set(key, [...(groups.get(key) ?? []), transaction])
  }

  const inferred = [...groups.values()].flatMap(inferredCandidates)
  return [...manual, ...inferred]
    .sort((a, b) => b.transaction.amountCents - a.transaction.amountCents)
}
