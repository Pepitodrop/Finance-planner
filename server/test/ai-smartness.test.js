import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
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
const closeTo = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

describe('deterministic financial smartness engine', () => {
  it('produces explainable resilience, stress and liquidity metrics', () => {
    const result = deterministicScenarioInsights(snapshot())
    assert.equal(result.savingsRate, 0.3)
    assert.equal(result.expenseRatio, 0.7)
    closeTo(result.recurringShare, 0.429, 0.001)
    closeTo(result.runwayMonths, 25.71, 0.01)
    assert.equal(result.recurringCoverageMonths, 60)
    assert.ok(result.resilienceScore >= 85)
    assert.deepEqual(result.stressTest, { incomeChangePercent: -10, expenseChangePercent: 10, stressedFreeCashCents: 39000, survivable: true })
    assert.deepEqual(result.insights, [])
  })

  it('prioritises critical liquidity and cashflow risks', () => {
    const result = deterministicScenarioInsights(snapshot({ incomeCents: 200000, expenseCents: 230000, freeCashCents: -30000, accountBalanceCents: 20000, recurringExpenseCents: 170000 }))
    for (const code of ['low_liquidity_runway', 'low_savings_rate', 'stress_test_negative', 'high_recurring_share']) assert.ok(codes(result).includes(code))
    assert.equal(result.insights[0].severity, 'critical')
    assert.ok(result.insights.every((entry) => entry.requiresApproval))
    assert.ok(result.resilienceScore < 40)
  })

  it('detects goals that cannot be funded from current cashflow', () => {
    const result = deterministicScenarioInsights(snapshot({ freeCashCents: 0, incomeCents: 210000, expenseCents: 210000, goals: [{ remainingCents: 500000, targetDate: '2027-08-01' }] }))
    assert.ok(codes(result).includes('goals_unfunded'))
    assert.equal(result.goalRemainingCents, 500000)
    assert.equal(result.monthsToFundGoals, null)
  })

  it('normalises goal funding to monthly free cashflow', () => {
    const result = deterministicScenarioInsights(snapshot({ freeCashCents: 10000, incomeCents: 250000, expenseCents: 240000, goals: [{ remainingCents: 500000, targetDate: '2030-08-01' }] }))
    assert.ok(codes(result).includes('goals_slow_progress'))
    assert.equal(result.monthsToFundGoals, 300)
  })

  it('abstains from high confidence when history is insufficient', () => {
    const result = deterministicScenarioInsights(snapshot({ transactionCount: 3, monthsCovered: 1 }))
    assert.ok(codes(result).includes('insufficient_history'))
    assert.ok(result.confidence < 0.2)
  })

  it('is scale invariant for ratio-based analysis', () => {
    const base = deterministicScenarioInsights(snapshot())
    const scaled = deterministicScenarioInsights(snapshot({ incomeCents: 600000, expenseCents: 420000, freeCashCents: 180000, recurringExpenseCents: 180000, accountBalanceCents: 1800000 }))
    for (const field of ['savingsRate', 'expenseRatio', 'recurringShare', 'runwayMonths', 'recurringCoverageMonths', 'resilienceScore']) assert.equal(scaled[field], base[field])
  })

  it('is monotonic: more balance cannot reduce runway or resilience', () => {
    const low = deterministicScenarioInsights(snapshot({ accountBalanceCents: 100000 }))
    const high = deterministicScenarioInsights(snapshot({ accountBalanceCents: 1000000 }))
    assert.ok(high.runwayMonths > low.runwayMonths)
    assert.ok(high.resilienceScore >= low.resilienceScore)
  })

  it('is monotonic: higher recurring burden cannot improve resilience', () => {
    const low = deterministicScenarioInsights(snapshot({ recurringExpenseCents: 50000 }))
    const high = deterministicScenarioInsights(snapshot({ recurringExpenseCents: 180000 }))
    assert.ok(high.recurringShare > low.recurringShare)
    assert.ok(high.resilienceScore <= low.resilienceScore)
  })

  it('handles a zero-expense snapshot without division errors', () => {
    const result = deterministicScenarioInsights(snapshot({ expenseCents: 0, recurringExpenseCents: 0, freeCashCents: 300000, accountBalanceCents: 100000 }))
    assert.equal(result.recurringShare, 0)
    assert.equal(result.runwayMonths, null)
    assert.equal(result.stressTest.survivable, true)
    assert.ok(Number.isFinite(result.resilienceScore))
  })

  it('supports legacy snapshots without goals or transaction counts', () => {
    const result = deterministicScenarioInsights({ incomeCents: 200000, expenseCents: 150000, freeCashCents: 50000, recurringExpenseCents: 60000, accountBalanceCents: 300000, monthsCovered: 3 })
    assert.equal(result.goalRemainingCents, 0)
    assert.ok(result.confidence >= 0 && result.confidence <= 1)
    assert.ok(codes(result).includes('insufficient_history'))
  })

  it('flags expenses without income as a critical data-backed condition', () => {
    const result = deterministicScenarioInsights(snapshot({ incomeCents: 0, expenseCents: 100000, freeCashCents: -100000 }))
    assert.equal(result.insights[0].code, 'no_income_with_expenses')
    assert.equal(result.insights[0].severity, 'critical')
  })
})
