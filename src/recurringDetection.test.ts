import { describe, expect, it } from 'vitest'
import { detectRecurringPayments } from './recurringDetection'
import type { Transaction } from './types'

function expense(id: string, date: string, amountCents: number, description = 'NETFLIX.COM 123456'): Transaction {
  return {
    id,
    accountId: 'checking',
    description,
    category: 'Streaming',
    type: 'expense',
    amountCents,
    date,
    recurring: false,
  }
}

describe('detectRecurringPayments', () => {
  it('detects monthly payments despite changing reference numbers', () => {
    const result = detectRecurringPayments([
      expense('1', '2026-01-03', 1299, 'SEPA NETFLIX.COM 123456'),
      expense('2', '2026-02-03', 1299, 'Lastschrift Netflix.com 987654'),
      expense('3', '2026-03-04', 1399, 'NETFLIX.COM Rechnung 456789'),
    ])

    expect(result).toHaveLength(1)
    expect(result[0].cadence).toBe('monthly')
    expect(result[0].transaction.amountCents).toBe(1299)
    expect(result[0].transaction.recurring).toBe(true)
    expect(result[0].confidence).toBeGreaterThanOrEqual(80)
  })

  it('normalizes weekly payments to a monthly amount', () => {
    const result = detectRecurringPayments([
      expense('1', '2026-01-02', 1000, 'Weekly Service'),
      expense('2', '2026-01-09', 1000, 'Weekly Service'),
      expense('3', '2026-01-16', 1000, 'Weekly Service'),
      expense('4', '2026-01-23', 1000, 'Weekly Service'),
    ])

    expect(result[0].cadence).toBe('weekly')
    expect(result[0].transaction.amountCents).toBe(4333)
  })

  it('does not classify irregular purchases as recurring', () => {
    const result = detectRecurringPayments([
      expense('1', '2026-01-01', 2500, 'Supermarkt'),
      expense('2', '2026-01-18', 6200, 'Supermarkt'),
      expense('3', '2026-02-27', 1800, 'Supermarkt'),
    ])

    expect(result).toEqual([])
  })

  it('keeps manually marked payments authoritative', () => {
    const manual = { ...expense('1', '2026-01-01', 4500, 'Fitnessstudio'), recurring: true }
    const result = detectRecurringPayments([manual])

    expect(result).toEqual([{ transaction: manual, cadence: 'manual', confidence: 100, occurrences: 1 }])
  })
})
