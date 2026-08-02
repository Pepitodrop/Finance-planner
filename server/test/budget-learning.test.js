import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBudgetFeedback,
  behaviorEventsFromFinanceState,
  buildBudgetSnapshot,
  createDeterministicBudgetPlan,
  publicLearningProfile,
  updateLearningProfile,
} from '../src/budget-learning.js'

const state = {
  accounts: [
    { id: 'a1', name: 'Private account', type: 'checking', balanceCents: 400000, currency: 'EUR' },
    { id: 'a2', name: 'Investment', type: 'investment', balanceCents: 900000, currency: 'EUR' },
  ],
  transactions: [
    { id: '1', accountId: 'a1', description: 'Salary ACME', category: 'Income', type: 'income', amountCents: 240000, date: '2026-06-01', recurring: true },
    { id: '2', accountId: 'a1', description: 'Private landlord', category: 'Housing', type: 'expense', amountCents: 80000, date: '2026-06-02', recurring: true },
    { id: '3', accountId: 'a1', description: 'Market', category: 'Groceries', type: 'expense', amountCents: 30000, date: '2026-06-10', recurring: false },
    { id: '4', accountId: 'a1', description: 'Salary ACME', category: 'Income', type: 'income', amountCents: 240000, date: '2026-07-01', recurring: true },
    { id: '5', accountId: 'a1', description: 'Private landlord', category: 'Housing', type: 'expense', amountCents: 80000, date: '2026-07-02', recurring: true },
    { id: '6', accountId: 'a1', description: 'Market', category: 'Groceries', type: 'expense', amountCents: 36000, date: '2026-07-10', recurring: false },
  ],
  goals: [{ id: 'g1', name: 'Emergency reserve', targetCents: 600000, currentCents: 100000, targetDate: '2027-07-01' }],
}

const now = new Date('2026-07-31T00:00:00Z')
const preferences = { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 70 }

function profileFor(snapshot, overrides = {}) {
  return updateLearningProfile(null, snapshot, {
    consentLocationContext: true,
    preferences,
    location: { country: 'DE', region: 'Baden-Württemberg', city: 'Karlsruhe', costLevel: 'medium' },
    ...overrides,
  }, now)
}

function allocatedCents(plan) {
  return plan.allocations.essentialCents
    + plan.allocations.flexibleCents
    + plan.allocations.emergencyFundCents
    + plan.allocations.savingsGoalsCents
    + plan.allocations.unallocatedCents
}

test('derives server-trusted behavior events without descriptions or identifiers', () => {
  const events = behaviorEventsFromFinanceState(state, now)
  assert.equal(events.length, 6)
  assert.deepEqual(Object.keys(events[0]).sort(), ['amountCents', 'categoryRank', 'date', 'recurring', 'type'])
  assert.equal(JSON.stringify(events).includes('Private landlord'), false)
  assert.equal(events.find((event) => event.type === 'expense')?.categoryRank, 1)
})

test('builds a bounded monthly snapshot and deterministic budget plan', () => {
  const snapshot = buildBudgetSnapshot(state, now)
  assert.equal(snapshot.monthsCovered, 2)
  assert.equal(snapshot.monthlyIncomeCents, 240000)
  assert.equal(snapshot.monthlyExpenseCents, 113000)
  assert.equal(snapshot.monthlyFreeCashCents, 127000)
  assert.equal(snapshot.accountBalanceCents, 1300000)
  assert.equal(snapshot.liquidBalanceCents, 400000)

  const plan = createDeterministicBudgetPlan(snapshot, profileFor(snapshot), now)
  assert.equal(allocatedCents(plan), snapshot.monthlyIncomeCents)
  assert.ok(plan.goalAllocations[0].recommendedMonthlyCents > 0)
  assert.ok(plan.recommendations.every((item) => item.requiresApproval === true))
  assert.match(plan.planId, /^budget-2026-07-31-[0-9a-f-]{36}$/i)
  assert.equal(plan.limitations.some((item) => /automatisch/.test(item)), true)
})

test('deficit and zero-income plans never allocate more than available income', () => {
  const deficitState = {
    accounts: [{ id: 'a1', type: 'checking', balanceCents: 0 }],
    transactions: [
      { id: 'i', category: 'Income', type: 'income', amountCents: 100000, date: '2026-07-01', recurring: true },
      { id: 'e1', category: 'Housing', type: 'expense', amountCents: 120000, date: '2026-07-02', recurring: true },
      { id: 'e2', category: 'Food', type: 'expense', amountCents: 30000, date: '2026-07-03', recurring: false },
    ],
    goals: [{ id: 'g', name: 'Goal', targetCents: 100000, currentCents: 0, targetDate: '2027-01-01' }],
  }
  const snapshot = buildBudgetSnapshot(deficitState, now)
  const plan = createDeterministicBudgetPlan(snapshot, profileFor(snapshot), now)
  assert.equal(plan.cashflowStatus, 'deficit')
  assert.equal(plan.monthlyDeficitCents, 50000)
  assert.equal(plan.allocations.emergencyFundCents, 0)
  assert.equal(plan.allocations.savingsGoalsCents, 0)
  assert.equal(allocatedCents(plan), snapshot.monthlyIncomeCents)
  assert.ok(plan.recommendations.some((item) => item.id === 'resolve-deficit'))

  const zeroSnapshot = buildBudgetSnapshot({ ...deficitState, transactions: deficitState.transactions.filter((item) => item.type === 'expense') }, now)
  const zeroPlan = createDeterministicBudgetPlan(zeroSnapshot, profileFor(zeroSnapshot), now)
  assert.equal(allocatedCents(zeroPlan), 0)
})

test('does not create a savings pool without active goals', () => {
  const snapshot = buildBudgetSnapshot({ ...state, goals: [] }, now)
  const plan = createDeterministicBudgetPlan(snapshot, profileFor(snapshot), now)
  assert.equal(plan.allocations.savingsGoalsCents, 0)
  assert.deepEqual(plan.goalAllocations, [])

  const completed = buildBudgetSnapshot({
    ...state,
    goals: [{ id: 'done', name: 'Done', targetCents: 10000, currentCents: 10000, targetDate: '2027-01-01' }],
  }, now)
  const completedPlan = createDeterministicBudgetPlan(completed, profileFor(completed), now)
  assert.equal(completedPlan.allocations.savingsGoalsCents, 0)
  assert.deepEqual(completedPlan.goalAllocations, [])
})

test('issues collision-resistant IDs for otherwise identical plans', () => {
  const snapshot = buildBudgetSnapshot(state, now)
  const profile = profileFor(snapshot)
  const first = createDeterministicBudgetPlan(snapshot, profile, now)
  const second = createDeterministicBudgetPlan(snapshot, profile, now)
  assert.notEqual(first.planId, second.planId)
})

test('preserves stored location without using it when consent is absent', () => {
  const snapshot = buildBudgetSnapshot(state, now)
  const initial = profileFor(snapshot)
  const updated = updateLearningProfile(initial, snapshot, {
    consentLocationContext: false,
    preferences,
    location: null,
  }, now)
  assert.equal(updated.location.city, 'Karlsruhe')
  const withLocation = createDeterministicBudgetPlan(snapshot, updated, now, { useLocation: true })
  const withoutLocation = createDeterministicBudgetPlan(snapshot, updated, now, { useLocation: false })
  assert.ok(withLocation.recommendations.some((item) => item.id === 'location-context'))
  assert.equal(withoutLocation.recommendations.some((item) => item.id === 'location-context'), false)
})

test('explicit feedback changes later allocations, caps, and optional recommendations', () => {
  const snapshot = buildBudgetSnapshot(state, now)
  const baseProfile = profileFor(snapshot)
  const baseline = createDeterministicBudgetPlan(snapshot, baseProfile, now)

  let learned = applyBudgetFeedback(baseProfile, baseline.planId, 'emergency-fund', 'approved', now)
  learned = applyBudgetFeedback(learned, baseline.planId, 'goal-allocation', 'rejected', now)
  learned = applyBudgetFeedback(learned, baseline.planId, 'reduce-flexible-spending', 'rejected', now)
  learned = applyBudgetFeedback(learned, baseline.planId, 'sustainable-budget', 'rejected', now)
  const nextPlan = createDeterministicBudgetPlan(snapshot, learned, new Date('2026-08-01T00:00:00Z'))
  learned = applyBudgetFeedback(learned, nextPlan.planId, 'sustainable-budget', 'rejected', now)
  const changed = createDeterministicBudgetPlan(snapshot, learned, now)

  assert.ok(changed.allocations.emergencyFundCents >= baseline.allocations.emergencyFundCents)
  assert.ok(changed.allocations.savingsGoalsCents < baseline.allocations.savingsGoalsCents)
  const baselineFlexibleCap = baseline.categoryCaps.find((item) => item.category === 'Groceries')?.recommendedCapCents
  const changedFlexibleCap = changed.categoryCaps.find((item) => item.category === 'Groceries')?.recommendedCapCents
  assert.ok(changedFlexibleCap >= baselineFlexibleCap)
  assert.equal(changed.recommendations.some((item) => item.id === 'reduce-flexible-spending'), false)
  assert.equal(changed.recommendations.some((item) => item.id === 'sustainable-budget'), false)
})

test('persists only a coarse profile and keeps feedback idempotent', () => {
  const snapshot = buildBudgetSnapshot(state, now)
  const profile = profileFor(snapshot, {
    preferences: { savingsStyle: 'ambitious', emergencyFundMonths: 4, sustainabilityPriority: 90 },
  })
  const plan = createDeterministicBudgetPlan(snapshot, profile, now)
  const updated = applyBudgetFeedback(profile, plan.planId, 'goal-allocation', 'approved', now)
  const duplicate = applyBudgetFeedback(updated, plan.planId, 'goal-allocation', 'approved', now)
  const switched = applyBudgetFeedback(duplicate, plan.planId, 'goal-allocation', 'rejected', now)
  const publicProfile = publicLearningProfile(switched)
  assert.equal(publicProfile.feedbackSummary['goal-allocation'].approved, 0)
  assert.equal(publicProfile.feedbackSummary['goal-allocation'].rejected, 1)
  assert.equal(publicProfile.privacy.rawDescriptionsPersisted, false)
  assert.equal(publicProfile.privacy.preciseCoordinatesPersisted, false)
  assert.equal(JSON.stringify(publicProfile).includes('Private landlord'), false)
})
