import type { Transaction } from './types'

export interface BankCategorySuggestion {
  category: string
  confidence: number
  evidenceCount: number
}

export interface BankImportQuality {
  score: number
  smartCategorized: number
  needsReview: number
  warnings: string[]
}

function merchantKey(value: string): string {
  return value
    .toLocaleLowerCase('de-DE')
    .replace(/\b(ec|visa|mastercard|lastschrift|kartenzahlung|zahlung|sepa|gmbh|ag|kg)\b/g, ' ')
    .replace(/\d{3,}/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 4)
    .join(' ')
}

export function suggestCategoryFromHistory(description: string, history: Transaction[]): BankCategorySuggestion | null {
  const key = merchantKey(description)
  if (!key) return null
  const matches = history.filter((item) => merchantKey(item.description) === key && item.category && !['Unkategorisiert', 'Sonstiges'].includes(item.category))
  if (matches.length < 2) return null
  const counts = new Map<string, number>()
  matches.forEach((item) => counts.set(item.category, (counts.get(item.category) ?? 0) + 1))
  const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  const confidence = Math.round((count / matches.length) * 100)
  return confidence >= 75 ? { category, confidence, evidenceCount: matches.length } : null
}

export function assessBankImportQuality(transactions: Transaction[], smartCategorized: number): BankImportQuality {
  if (!transactions.length) return { score: 0, smartCategorized: 0, needsReview: 0, warnings: ['Keine importierbaren Buchungen gefunden.'] }
  const missingCategory = transactions.filter((item) => !item.category || item.category === 'Unkategorisiert').length
  const weakDescriptions = transactions.filter((item) => item.description.length < 4).length
  const invalidDates = transactions.filter((item) => Number.isNaN(Date.parse(item.date))).length
  const needsReview = missingCategory + weakDescriptions + invalidDates
  const penalty = Math.round((missingCategory * 35 + weakDescriptions * 20 + invalidDates * 45) / transactions.length)
  const score = Math.max(0, Math.min(100, 100 - penalty))
  const warnings: string[] = []
  if (missingCategory) warnings.push(`${missingCategory} Buchungen benötigen eine Kategorieprüfung.`)
  if (weakDescriptions) warnings.push(`${weakDescriptions} Buchungen haben schwache Händlerdaten.`)
  if (invalidDates) warnings.push(`${invalidDates} Buchungen enthalten ungültige Datumswerte.`)
  return { score, smartCategorized, needsReview, warnings }
}
