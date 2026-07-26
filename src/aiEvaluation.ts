export interface EvaluationExample {
  id: string
  description: string
  amountCents: number
  expectedCategory: string
  recurring: boolean
  split: 'train' | 'validation' | 'test'
  confirmedByHuman: boolean
  tags: Array<'ambiguous' | 'refund' | 'income' | 'unknown-merchant' | 'recurring' | 'german-booking-text'>
}

export interface DatasetReadiness {
  ready: boolean
  total: number
  confirmed: number
  testExamples: number
  categories: number
  missingRequirements: string[]
}

export function assessEvaluationDataset(examples: EvaluationExample[]): DatasetReadiness {
  const confirmed = examples.filter((item) => item.confirmedByHuman).length
  const testExamples = examples.filter((item) => item.split === 'test').length
  const categories = new Set(examples.map((item) => item.expectedCategory)).size
  const tags = new Set(examples.flatMap((item) => item.tags))
  const missingRequirements: string[] = []

  if (examples.length < 300) missingRequirements.push('Mindestens 300 anonymisierte Beispiele erfassen.')
  if (confirmed !== examples.length) missingRequirements.push('Alle Labels müssen menschlich bestätigt sein.')
  if (testExamples < 60) missingRequirements.push('Mindestens 60 Beispiele als unveränderlichen Testsatz reservieren.')
  if (categories < 8) missingRequirements.push('Mindestens acht relevante Kategorien abdecken.')
  for (const tag of ['ambiguous', 'refund', 'income', 'unknown-merchant', 'recurring', 'german-booking-text'] as const) {
    if (!tags.has(tag)) missingRequirements.push(`Szenario „${tag}“ fehlt.`)
  }

  return {
    ready: missingRequirements.length === 0,
    total: examples.length,
    confirmed,
    testExamples,
    categories,
    missingRequirements,
  }
}
