import { describe, expect, it } from 'vitest'
import { goalProgress, summarizeGoals, validateGoalDraft } from './goalsModel'

describe('goals model', () => {
  const goals = [
    { id: 'a', name: 'Emergency fund', targetCents: 600_000, currentCents: 360_000, targetDate: '2026-12-15' },
    { id: 'b', name: 'Course', targetCents: 350_000, currentCents: 65_000, targetDate: '2027-04-30' },
  ]
  it('reconciles integer-cent summary and selects the earliest active date', () => expect(summarizeGoals(goals)).toEqual({ targetCents: 950_000, savedCents: 425_000, remainingCents: 525_000, nextGoal: goals[0] }))
  it('clamps progress', () => { expect(goalProgress(goals[0])).toBe(60); expect(goalProgress({ ...goals[0], currentCents: 900_000 })).toBe(100); expect(goalProgress({ ...goals[0], targetCents: 0 })).toBe(0) })
  it('validates supported fields and bounds', () => {
    expect(validateGoalDraft({ name: '', target: 1, current: 0, targetDate: '2026-01-01' })).toMatch(/name/i)
    expect(validateGoalDraft({ name: 'Goal', target: 0, current: 0, targetDate: '2026-01-01' })).toMatch(/greater/i)
    expect(validateGoalDraft({ name: 'Goal', target: 10, current: 11, targetDate: '2026-01-01' })).toMatch(/exceed/i)
    expect(validateGoalDraft({ name: 'Goal', target: 10, current: 1, targetDate: '2026-01-01' })).toBeNull()
  })
})
