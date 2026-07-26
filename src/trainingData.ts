import type { Transaction } from './types'

export interface TrainingExample {
  text: string
  target: string
}

export interface TrainingReadiness {
  ready: boolean
  totalExamples: number
  categories: Record<string, number>
  warnings: string[]
}

function sanitizeDescription(description: string): string {
  return description
    .replace(/\b(?:DE\d{20}|[A-Z]{2}\d{2}(?:\s?\d{4}){3,7})\b/gi, '[IBAN]')
    .replace(/\b\d{8,}\b/g, '[REFERENCE]')
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildTrainingExamples(transactions: Transaction[]): TrainingExample[] {
  const seen = new Set<string>()
  const examples: TrainingExample[] = []

  for (const transaction of transactions) {
    const text = sanitizeDescription(transaction.description)
    const target = transaction.category.trim()
    if (!text || !target || target === 'Sonstiges') continue
    const key = `${text.toLocaleLowerCase('de-DE')}\u0000${target}`
    if (seen.has(key)) continue
    seen.add(key)
    examples.push({ text, target })
  }

  return examples
}

export function assessTrainingReadiness(examples: TrainingExample[], minimumPerCategory = 20, minimumTotal = 200): TrainingReadiness {
  const categories = examples.reduce<Record<string, number>>((counts, example) => {
    counts[example.target] = (counts[example.target] ?? 0) + 1
    return counts
  }, {})
  const warnings: string[] = []

  if (examples.length < minimumTotal) warnings.push(`Mindestens ${minimumTotal} bestätigte Beispiele empfohlen; vorhanden: ${examples.length}.`)
  for (const [category, count] of Object.entries(categories)) {
    if (count < minimumPerCategory) warnings.push(`Kategorie „${category}“ hat nur ${count} Beispiele; empfohlen sind mindestens ${minimumPerCategory}.`)
  }
  if (Object.keys(categories).length < 3) warnings.push('Mindestens drei ausreichend belegte Kategorien werden für ein belastbares Modell empfohlen.')

  return { ready: warnings.length === 0, totalExamples: examples.length, categories, warnings }
}

export function toAutoTrainJsonl(examples: TrainingExample[]): string {
  return examples.map((example) => JSON.stringify(example)).join('\n')
}

export function splitTrainingExamples(examples: TrainingExample[], validationRatio = .2): { train: TrainingExample[]; validation: TrainingExample[] } {
  const byCategory = new Map<string, TrainingExample[]>()
  for (const example of examples) byCategory.set(example.target, [...(byCategory.get(example.target) ?? []), example])

  const train: TrainingExample[] = []
  const validation: TrainingExample[] = []
  for (const categoryExamples of byCategory.values()) {
    const validationCount = Math.max(1, Math.floor(categoryExamples.length * validationRatio))
    validation.push(...categoryExamples.filter((_, index) => index % Math.ceil(categoryExamples.length / validationCount) === 0).slice(0, validationCount))
    const validationSet = new Set(validation)
    train.push(...categoryExamples.filter((example) => !validationSet.has(example)))
  }
  return { train, validation }
}
