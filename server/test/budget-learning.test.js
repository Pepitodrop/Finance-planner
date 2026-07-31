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
  accounts: [{ id: 'a1', name: 'Private account', balanceCents: 400000, currency: 'EUR' }],
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

  const profile = updateLearningProfile(null, snapshot, {
    preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 70 },
    location: { country: 'DE', region: 'Baden-Württemberg', city: 'Karlsruhe', costLevel: 'medium' },
  }, now)
  const plan = createDeterministicBudgetPlan(snapshot, profile, now)
  const allocated = plan.allocations.essentialCents + plan.allocations.flexibleCents + plan.allocations.emergencyFundCents + plan.allocations.savingsGoalsCents + plan.allocations.unallocatedCents
  assert.equal(allocated, snapshot.monthlyIncomeCents)
  assert.ok(plan.goalAllocations[0].recommendedMonthlyCents > 0)
  assert.ok(plan.recommendations.every((item) => item.requiresApproval === true))
  assert.equal(plan.limitations.some((item) => /automatisch/.test(item)), true)
})

test('persists only a coarse profile and learns from explicit feedback', () => {
  const snapshot = buildBudgetSnapshot(state, now)
  const profile = updateLearningProfile(null, snapshot, {
    preferences: { savingsStyle: 'ambitious', emergencyFundMonths: 4, sustainabilityPriority: 90 },
    location: { country: 'DE', region: 'Baden-Württemberg', city: 'Karlsruhe', costLevel: 'high' },
  }, now)
  const updated = applyBudgetFeedback(profile, 'goal-allocation', 'approved', now)
  const publicProfile = publicLearningProfile(updated)
  assert.equal(publicProfile.feedbackSummary['goal-allocation'].approved, 1)
  assert.equal(publicProfile.privacy.rawDescriptionsPersisted, false)
  assert.equal(publicProfile.privacy.preciseCoordinatesPersisted, false)
  assert.equal(JSON.stringify(publicProfile).includes('Private landlord'), false)
})
