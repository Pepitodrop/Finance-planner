import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import {
  applyBudgetFeedback,
  buildBudgetSnapshot,
  createDeterministicBudgetPlan,
  publicLearningProfile,
  updateLearningProfile,
} from '../server/src/budget-learning.js'

const configuration = JSON.parse(await readFile(new URL('../ai/evaluation/budget-learning-quality.json', import.meta.url), 'utf8'))
assert.equal(configuration.schemaVersion, 1)
assert.equal(configuration.currency, 'EUR')

const NOW = new Date('2026-07-31T12:00:00.000Z')
const MONTHS = ['2026-05', '2026-06', '2026-07']
const CENTS = 100
const round = (value) => Math.max(0, Math.round(value))

function scenarioState({ incomeCents, expenseRatio, savingsStyle, goalState, liquidityState }, index) {
  const monthlyExpenseCents = round(Math.max(incomeCents, 120_000) * expenseRatio)
  const essentialCents = round(monthlyExpenseCents * 0.65)
  const flexibleCents = monthlyExpenseCents - essentialCents
  const transactions = []
  for (const [monthIndex, month] of MONTHS.entries()) {
    if (incomeCents > 0) transactions.push({
      id: `income-${index}-${monthIndex}`,
      accountId: 'checking',
      description: `Private salary source ${index}`,
      category: 'Income',
      type: 'income',
      amountCents: incomeCents,
      date: `${month}-01`,
      recurring: true,
    })
    if (essentialCents > 0) transactions.push({
      id: `essential-${index}-${monthIndex}`,
      accountId: 'checking',
      description: `Private landlord ${index}`,
      category: 'Housing',
      type: 'expense',
      amountCents: essentialCents,
      date: `${month}-03`,
      recurring: true,
    })
    if (flexibleCents > 0) transactions.push({
      id: `flexible-${index}-${monthIndex}`,
      accountId: 'checking',
      description: `Private merchant ${index}`,
      category: 'Groceries',
      type: 'expense',
      amountCents: flexibleCents,
      date: `${month}-12`,
      recurring: false,
    })
  }

  const liquidBalanceCents = liquidityState === 'none'
    ? 0
    : liquidityState === 'partial'
      ? monthlyExpenseCents
      : monthlyExpenseCents * 4
  const goal = {
    id: `goal-${index}`,
    name: `Private goal ${index}`,
    targetCents: 600_000,
    currentCents: goalState === 'completed' ? 600_000 : 50_000,
    targetDate: '2027-07-01',
  }
  return {
    state: {
      accounts: [
        { id: 'checking', name: `Private checking ${index}`, type: 'checking', balanceCents: liquidBalanceCents, currency: 'EUR' },
        { id: 'investment', name: `Private investment ${index}`, type: 'investment', balanceCents: 9_000_000, currency: 'EUR' },
      ],
      transactions,
      goals: goalState === 'none' ? [] : [goal],
    },
    expected: { incomeCents, monthlyExpenseCents, liquidBalanceCents, goalState, savingsStyle },
  }
}

function generatedCases() {
  const cases = []
  const incomes = configuration.dimensions.monthlyIncomeCents
  const ratios = configuration.dimensions.monthlyExpenseRatios
  const styles = configuration.dimensions.savingsStyles
  const goals = configuration.dimensions.goalStates
  const liquidity = configuration.dimensions.liquidityStates
  let index = 0
  for (const incomeCents of incomes) {
    for (const expenseRatio of ratios) {
      const savingsStyle = styles[index % styles.length]
      const goalState = goals[index % goals.length]
      const liquidityState = liquidity[Math.floor(index / goals.length) % liquidity.length]
      cases.push({ id: `budget-${index + 1}`, ...scenarioState({ incomeCents, expenseRatio, savingsStyle, goalState, liquidityState }, index) })
      index += 1
    }
  }
  for (let extra = 0; extra < 12; extra += 1) {
    const incomeCents = incomes[(extra + 1) % incomes.length]
    const expenseRatio = ratios[(extra + 2) % ratios.length]
    const savingsStyle = styles[(extra + 1) % styles.length]
    const goalState = goals[(extra + 2) % goals.length]
    const liquidityState = liquidity[(extra + 1) % liquidity.length]
    cases.push({ id: `budget-${index + 1}`, ...scenarioState({ incomeCents, expenseRatio, savingsStyle, goalState, liquidityState }, index) })
    index += 1
  }
  return cases
}

function allocatedCents(plan) {
  return plan.allocations.essentialCents
    + plan.allocations.flexibleCents
    + plan.allocations.emergencyFundCents
    + plan.allocations.savingsGoalsCents
    + plan.allocations.unallocatedCents
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

const cases = generatedCases()
assert.ok(cases.length >= configuration.minimumCases)
const results = []
for (const item of cases) {
  const startedAt = performance.now()
  const snapshot = buildBudgetSnapshot(item.state, NOW)
  const profile = updateLearningProfile(null, snapshot, {
    consentLocationContext: false,
    preferences: {
      savingsStyle: item.expected.savingsStyle,
      emergencyFundMonths: 3,
      sustainabilityPriority: 60,
    },
    location: null,
  }, NOW)
  const plan = createDeterministicBudgetPlan(snapshot, profile, NOW)
  const publicProfile = publicLearningProfile(profile)
  const isDeficit = snapshot.monthlyExpenseCents > snapshot.monthlyIncomeCents
  const noActiveGoal = item.expected.goalState !== 'active'
  results.push({
    id: item.id,
    latencyMs: performance.now() - startedAt,
    allocationConserved: allocatedCents(plan) === snapshot.monthlyIncomeCents,
    deficitSafe: !isDeficit || (
      plan.cashflowStatus === 'deficit'
      && plan.allocations.emergencyFundCents === 0
      && plan.allocations.savingsGoalsCents === 0
      && allocatedCents(plan) <= snapshot.monthlyIncomeCents
    ),
    activeGoalIntegrity: !noActiveGoal || (plan.allocations.savingsGoalsCents === 0 && plan.goalAllocations.length === 0),
    liquidReserveIntegrity: snapshot.liquidBalanceCents === item.expected.liquidBalanceCents
      && plan.emergencyFund.currentBalanceCents === item.expected.liquidBalanceCents,
    approvalBoundary: plan.recommendations.every((recommendation) => recommendation.requiresApproval === true),
    privacyRedacted: !JSON.stringify(publicProfile).includes(`Private salary source`)
      && !JSON.stringify(publicProfile).includes(`Private landlord`)
      && !JSON.stringify(publicProfile).includes(`Private merchant`)
      && !JSON.stringify(publicProfile).includes(`Private checking`)
      && !JSON.stringify(publicProfile).includes(`Private investment`)
      && !JSON.stringify(publicProfile).includes(`Private goal`),
  })
}

const adaptationState = {
  accounts: [
    { id: 'cash', name: 'Private cash', type: 'checking', balanceCents: 100_000, currency: 'EUR' },
    { id: 'portfolio', name: 'Private portfolio', type: 'investment', balanceCents: 1_000_000, currency: 'EUR' },
  ],
  transactions: [
    { id: 'i1', accountId: 'cash', description: 'Private income', category: 'Income', type: 'income', amountCents: 260_000, date: '2026-06-01', recurring: true },
    { id: 'e1', accountId: 'cash', description: 'Private rent', category: 'Housing', type: 'expense', amountCents: 90_000, date: '2026-06-02', recurring: true },
    { id: 'e2', accountId: 'cash', description: 'Private food', category: 'Groceries', type: 'expense', amountCents: 55_000, date: '2026-06-10', recurring: false },
    { id: 'i2', accountId: 'cash', description: 'Private income', category: 'Income', type: 'income', amountCents: 260_000, date: '2026-07-01', recurring: true },
    { id: 'e3', accountId: 'cash', description: 'Private rent', category: 'Housing', type: 'expense', amountCents: 90_000, date: '2026-07-02', recurring: true },
    { id: 'e4', accountId: 'cash', description: 'Private food', category: 'Groceries', type: 'expense', amountCents: 60_000, date: '2026-07-10', recurring: false },
  ],
  goals: [{ id: 'goal', name: 'Private target', targetCents: 500_000, currentCents: 10_000, targetDate: '2027-08-01' }],
}
const adaptationSnapshot = buildBudgetSnapshot(adaptationState, NOW)
const adaptationProfile = updateLearningProfile(null, adaptationSnapshot, {
  consentLocationContext: false,
  preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 70 },
  location: null,
}, NOW)
const baseline = createDeterministicBudgetPlan(adaptationSnapshot, adaptationProfile, NOW)
let learned = applyBudgetFeedback(adaptationProfile, baseline.planId, 'emergency-fund', 'approved', NOW)
learned = applyBudgetFeedback(learned, baseline.planId, 'goal-allocation', 'rejected', NOW)
learned = applyBudgetFeedback(learned, baseline.planId, 'reduce-flexible-spending', 'rejected', NOW)
learned = applyBudgetFeedback(learned, baseline.planId, 'sustainable-budget', 'rejected', NOW)
const second = createDeterministicBudgetPlan(adaptationSnapshot, learned, new Date('2026-08-01T12:00:00.000Z'))
learned = applyBudgetFeedback(learned, second.planId, 'sustainable-budget', 'rejected', NOW)
const adapted = createDeterministicBudgetPlan(adaptationSnapshot, learned, new Date('2026-08-02T12:00:00.000Z'))
const baselineFlexibleCap = baseline.categoryCaps.find((item) => item.category === 'Groceries')?.recommendedCapCents || 0
const adaptedFlexibleCap = adapted.categoryCaps.find((item) => item.category === 'Groceries')?.recommendedCapCents || 0
const adaptationChecks = [
  adapted.allocations.emergencyFundCents >= baseline.allocations.emergencyFundCents,
  adapted.allocations.savingsGoalsCents < baseline.allocations.savingsGoalsCents,
  adaptedFlexibleCap >= baselineFlexibleCap,
  !adapted.recommendations.some((item) => item.id === 'reduce-flexible-spending'),
  !adapted.recommendations.some((item) => item.id === 'sustainable-budget'),
]

const rate = (key) => results.filter((result) => result[key]).length / results.length
const measured = {
  cases: results.length,
  allocationConservationRate: rate('allocationConserved'),
  deficitSafetyRate: rate('deficitSafe'),
  activeGoalIntegrityRate: rate('activeGoalIntegrity'),
  liquidReserveIntegrityRate: rate('liquidReserveIntegrity'),
  approvalBoundaryRate: rate('approvalBoundary'),
  privacyRedactionRate: rate('privacyRedacted'),
  feedbackAdaptationRate: adaptationChecks.filter(Boolean).length / adaptationChecks.length,
  p95LatencyMs: percentile(results.map((result) => result.latencyMs), 0.95),
}

const thresholds = configuration.thresholds
for (const key of [
  'allocationConservationRate',
  'deficitSafetyRate',
  'activeGoalIntegrityRate',
  'liquidReserveIntegrityRate',
  'approvalBoundaryRate',
  'privacyRedactionRate',
  'feedbackAdaptationRate',
]) assert.ok(measured[key] >= thresholds[key], `${key} ${measured[key]} is below ${thresholds[key]}`)
assert.ok(measured.p95LatencyMs <= thresholds.maximumP95LatencyMs, `p95 latency ${measured.p95LatencyMs}ms exceeds ${thresholds.maximumP95LatencyMs}ms`)
assert.ok(adaptationState.transactions.every((transaction) => Number.isSafeInteger(transaction.amountCents) && transaction.amountCents >= CENTS))

console.log(`Budget learning quality passed: ${JSON.stringify(measured)}`)
