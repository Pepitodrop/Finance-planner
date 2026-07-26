import { describe, expect, it } from 'vitest'
import { assessTrainingReadiness, buildTrainingExamples, splitTrainingExamples, toAutoTrainJsonl } from './trainingData'
import type { Transaction } from './types'

const transaction = (description: string, category: string, id = description): Transaction => ({
  id,
  accountId: 'checking',
  description,
  category,
  type: 'expense',
  amountCents: 1000,
  date: '2026-01-01',
  recurring: false,
})

describe('Hugging Face training data', () => {
  it('removes sensitive references, excludes Sonstiges, and deduplicates', () => {
    const examples = buildTrainingExamples([
      transaction('Überweisung DE89370400440532013000 123456789', 'Wohnen', '1'),
      transaction('Überweisung DE89370400440532013000 123456789', 'Wohnen', '2'),
      transaction('Unklar', 'Sonstiges', '3'),
    ])

    expect(examples).toEqual([{ text: 'Überweisung [IBAN] [REFERENCE]', target: 'Wohnen' }])
  })

  it('reports insufficient and imbalanced datasets before training', () => {
    const readiness = assessTrainingReadiness([
      { text: 'REWE', target: 'Lebensmittel' },
      { text: 'Miete', target: 'Wohnen' },
    ], 2, 4)

    expect(readiness.ready).toBe(false)
    expect(readiness.warnings.length).toBeGreaterThan(0)
  })

  it('exports AutoTrain JSONL and keeps categories in both splits', () => {
    const examples = [
      { text: 'REWE 1', target: 'Lebensmittel' },
      { text: 'REWE 2', target: 'Lebensmittel' },
      { text: 'Miete 1', target: 'Wohnen' },
      { text: 'Miete 2', target: 'Wohnen' },
    ]
    const split = splitTrainingExamples(examples, .5)

    expect(split.train.map((item) => item.target).sort()).toEqual(['Lebensmittel', 'Wohnen'])
    expect(split.validation.map((item) => item.target).sort()).toEqual(['Lebensmittel', 'Wohnen'])
    expect(toAutoTrainJsonl(examples).split('\n')).toHaveLength(4)
  })
})
