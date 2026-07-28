import { describe, expect, it } from 'vitest'
import { deterministicScenarioInsights } from '../src/ai-ensemble.js'

const snapshot = (overrides = {}) => ({
  incomeCents: 300000,
  expenseCents: 210000,
  freeCashCents: 90000,
  recurringExpenseCents: 90000,
  accountBalanceCents: 900000,
  transactionCount: 90,
  monthsCovered: 6,
  categoryTotals: [],
  goals: [],
  ...overrides,
})

const codes = (result) => result.insights.map((entry) => entry.code)

describe('deterministic financial smartness engine', () => {
  it('produces explainable resilience, stress and liquidity metrics', () => {
    const result = deterministicScenarioInsights(snapshot())
    expect(result.savingsRate).toBe(0.3)
    expect(result.expenseRatio).toBe(0.7)
    expect(result.recurringShare).toBeCloseTo(0.429, 3)
    expect(result.runwayMonths).toBeCloseTo(25.71, 2)
    expect(result.resilienceScore).toBeGreaterThanOrEqual(85)
    expect(result.stressTest).toEqual({ incomeChangePercent: -10, expenseChangePercent: 10, stressedFreeCashCents: 39000, survivable: true })
    expect(result.insights).toEqual([])
  })

  it('prioritises critical liquidity and cashflow risks', () => {
    const result = deterministicScenarioInsights(snapshot({
      incomeCents: 200000,
      expenseCents: 230000,
      freeCashCents: -30000,
      accountBalanceCents: 20000,
      recurringExpenseCents: 170000,
    }))
    expect(codes(result)).toEqual(expect.arrayContaining(['low_liquidity_runway', 'low_savings_rate', 'stress_test_negative', 'high_recurring_share']))
    expect(result.insights[0].severity).toBe('critical')
    expect(result.insights.every((entry) => entry.requiresApproval)).toBe(true)
    expect(result.resilienceScore).toBeLessThan(40)
  })

  it('detects goals that cannot be funded from current cashflow', () => {
    const result = deterministicScenarioInsights(snapshot({
      freeCashCents: 0,
      incomeCents: 210000,
      expenseCents: 210000,
      goals: [{ remainingCents: 500000, targetDate: '2027-08-01' }],
    }))
    expect(codes(result)).toContain('goals_unfunded')
    expect(result.goalRemainingCents).toBe(500000)
    expect(result.monthsToFundGoals).toBeNull()
  })

  it('detects goals with implausibly slow progress', () => {
    const result = deterministicScenarioInsights(snapshot({
      freeCashCents: 10000,
      incomeCents: 250000,
      expenseCents: 240000,
      goals: [{ remainingCents: 500000, targetDate: '2030-08-01' }],
    }))
    expect(codes(result)).toContain('goals_slow_progress')
    expect(result.monthsToFundGoals).toBe(50)
  })

  it('abstains from high confidence when history is insufficient', () => {
    const result = deterministicScenarioInsights(snapshot({ transactionCount: 3, monthsCovered: 1 }))
    expect(codes(result)).toContain('insufficient_history')
    expect(result.confidence).toBeLessThan(0.2)
  })

  it('is scale invariant for ratio-based analysis', () => {
    const base = deterministicScenarioInsights(snapshot())
    const scaled = deterministicScenarioInsights(snapshot({
      incomeCents: 600000,
      expenseCents: 420000,
      freeCashCents: 180000,
      recurringExpenseCents: 180000,
      accountBalanceCents: 1800000,
    }))
    expect(scaled.savingsRate).toBe(base.savingsRate)
    expect(scaled.expenseRatio).toBe(base.expenseRatio)
    expect(scaled.recurringShare).toBe(base.recurringShare)
    expect(scaled.runwayMonths).toBe(base.runwayMonths)
    expect(scaled.resilienceScore).toBe(base.resilienceScore)
  })

  it('is monotonic: more balance cannot reduce runway or resilience', () => {
    const low = deterministicScenarioInsights(snapshot({ accountBalanceCents: 100000 }))
    const high = deterministicScenarioInsights(snapshot({ accountBalanceCents: 1000000 }))
    expect(high.runwayMonths).toBeGreaterThan(low.runwayMonths)
    expect(high.resilienceScore).toBeGreaterThanOrEqual(low.resilienceScore)
  })

  it('is monotonic: higher recurring burden cannot improve resilience', () => {
    const low = deterministicScenarioInsights(snapshot({ recurringExpenseCents: 50000 }))
    const high = deterministicScenarioInsights(snapshot({ recurringExpenseCents: 180000 }))
    expect(high.recurringShare).toBeGreaterThan(low.recurringShare)
    expect(high.resilienceScore).toBeLessThanOrEqual(low.resilienceScore)
  })

  it('handles a zero-expense snapshot without division errors', () => {
    const result = deterministicScenarioInsights(snapshot({
      expenseCents: 0,
      recurringExpenseCents: 0,
      freeCashCents: 300000,
      accountBalanceCents: 100000,
    }))
    expect(result.recurringShare).toBe(0)
    expect(result.runwayMonths).toBeNull()
    expect(result.stressTest.survivable).toBe(true)
    expect(Number.isFinite(result.resilienceScore)).toBe(true)
  })

  it('flags expenses without income as a critical data-backed condition', () => {
    const result = deterministicScenarioInsights(snapshot({ incomeCents: 0, expenseCents: 100000, freeCashCents: -100000 }))
    expect(result.insights[0].code).toBe('no_income_with_expenses')
    expect(result.insights[0].severity).toBe('critical')
  })
})
