import { describe, expect, it, vi } from 'vitest'
import { behaviorBanditScore } from './graphIntelligence'
import type { BehaviorEdge } from './behavior'

describe('behavior graph intelligence', () => {
  it('rewards repeated confirmed behavior', () => {
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'))
    const base: BehaviorEdge = {
      merchant: 'rewe',
      category: 'Lebensmittel',
      weight: 0.7,
      confirmations: 1,
      recurringVotes: 0,
      lastUpdated: '2026-07-25T12:00:00Z',
    }
    expect(behaviorBanditScore({ ...base, confirmations: 10 })).toBeGreaterThan(behaviorBanditScore(base))
    vi.useRealTimers()
  })

  it('decays stale evidence without deleting it', () => {
    vi.setSystemTime(new Date('2026-07-26T12:00:00Z'))
    const recent: BehaviorEdge = {
      merchant: 'netflix',
      category: 'Verträge',
      weight: 0.8,
      confirmations: 5,
      recurringVotes: 5,
      lastUpdated: '2026-07-25T12:00:00Z',
    }
    const stale = { ...recent, lastUpdated: '2024-07-25T12:00:00Z' }
    expect(behaviorBanditScore(recent)).toBeGreaterThan(behaviorBanditScore(stale))
    vi.useRealTimers()
  })
})
