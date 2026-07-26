import { describe, expect, it } from 'vitest'
import { assessSmartness } from './smartness'
import type { AiQualityReport } from './aiQuality'
import type { BankConnectionReadiness } from './bankConnection'
import type { AppState } from './types'

const state: AppState = {
  accounts: [],
  goals: [],
  transactions: Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    accountId: 'a',
    description: `Transaction ${index}`,
    category: ['Food', 'Housing', 'Mobility', 'Income'][index % 4],
    type: 'expense' as const,
    amountCents: 1000,
    date: `2026-${String((index % 8) + 1).padStart(2, '0')}-01`,
    recurring: index % 5 === 0,
  })),
}

const quality: AiQualityReport = { score: 92, productionReady: true, passed: ['all'], failed: [] }
const bank: BankConnectionReadiness = {
  score: 100,
  productionReady: true,
  passed: ['consent', 'sync', 'idempotency'],
  failed: [],
}

describe('bank-backed smartness', () => {
  it('reports bank data quality independently', () => {
    const disconnected = assessSmartness(state, 20, quality)
    const connected = assessSmartness(state, 20, quality, bank)
    expect(disconnected.dimensions.find((item) => item.key === 'bank')?.score).toBe(5)
    expect(connected.dimensions.find((item) => item.key === 'bank')?.score).toBe(100)
    expect(connected.overall).toBeGreaterThan(disconnected.overall)
  })
})
