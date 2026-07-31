import assert from 'node:assert/strict'
import test from 'node:test'
import { decryptBudgetProfile, encryptBudgetProfile } from '../src/budget-profile-store.js'

const secret = '0123456789abcdef0123456789abcdef'
const profile = {
  version: 1,
  enabled: true,
  preferences: { savingsStyle: 'balanced', emergencyFundMonths: 3, sustainabilityPriority: 60 },
  location: { country: 'DE', region: null, city: null, costLevel: 'unknown' },
  feedback: {},
  patterns: { categoryPreferences: [], monthlyIncomeCents: 0, monthlyExpenseCents: 0, monthlyRecurringCents: 0, savingsCapacityCents: 0, volatilityCents: 0, goalCount: 0 },
  confidence: 0.2,
  learnedFromTransactions: 0,
  firstLearnedAt: '2026-08-01T00:00:00.000Z',
  lastLearnedAt: '2026-08-01T00:00:00.000Z',
  privacy: { rawDescriptionsPersisted: false, preciseCoordinatesPersisted: false, externalInferenceRequiresConsent: true, userCanReset: true },
}

test('budget profiles are encrypted and bound to the authenticated user', () => {
  const envelope = encryptBudgetProfile(profile, secret, 'user-1')
  assert.equal(JSON.stringify(envelope).includes('balanced'), false)
  assert.deepEqual(decryptBudgetProfile(envelope, secret, 'user-1'), profile)
  assert.throws(() => decryptBudgetProfile(envelope, secret, 'user-2'))
})
