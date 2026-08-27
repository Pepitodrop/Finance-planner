import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAccountExclusions, isValidStableAccountId } from './account-exclusions.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

test('isValidStableAccountId only accepts exactly 64 lowercase hex characters', () => {
  assert.equal(isValidStableAccountId(HASH_A), true)
  assert.equal(isValidStableAccountId(HASH_A.toUpperCase()), false)
  assert.equal(isValidStableAccountId(HASH_A.slice(0, 63)), false)
  assert.equal(isValidStableAccountId(`${HASH_A}a`), false)
  assert.equal(isValidStableAccountId(''), false)
  assert.equal(isValidStableAccountId(null), false)
  assert.equal(isValidStableAccountId({ stableAccountId: HASH_A }), false)
})

test('applyAccountExclusions is a no-op when nothing is excluded', () => {
  const accounts = [{ externalId: 'e1', stableId: HASH_A }]
  const transactions = [{ externalAccountId: 'e1' }]
  const result = applyAccountExclusions([], accounts, transactions)
  assert.equal(result.accounts, accounts)
  assert.equal(result.transactions, transactions)
})

test('applyAccountExclusions filters an excluded account and only its own transactions', () => {
  const accounts = [
    { externalId: 'excluded-session-id', stableId: HASH_A, name: 'Excluded' },
    { externalId: 'kept-session-id', stableId: HASH_B, name: 'Kept' },
  ]
  const transactions = [
    { externalAccountId: 'excluded-session-id', description: 'should be filtered' },
    { externalAccountId: 'kept-session-id', description: 'should remain' },
  ]
  const result = applyAccountExclusions([HASH_A], accounts, transactions)
  assert.deepEqual(result.accounts.map((a) => a.name), ['Kept'])
  assert.deepEqual(result.transactions.map((t) => t.description), ['should remain'])
})

// This is the exact scenario the reconnect-dedup fix's stableId matching
// depends on: the SAME real account can arrive under a NEW provider-session
// externalId after a reconnect. Exclusion must still recognize it via
// stableId even though externalId changed -- excluding by externalId alone
// would let a removed account resurrect itself under its next session id.
test('applyAccountExclusions matches by stableId, not externalId, so a reconnect under a new session id is still excluded', () => {
  const accounts = [{ externalId: 'new-session-id-after-reconnect', stableId: HASH_A, name: 'Should stay excluded' }]
  const transactions = [{ externalAccountId: 'new-session-id-after-reconnect' }]
  const result = applyAccountExclusions([HASH_A], accounts, transactions)
  assert.deepEqual(result.accounts, [])
  assert.deepEqual(result.transactions, [])
})

test('applyAccountExclusions never excludes an account with no stableId, even if a stored exclusion happens to be present -- nothing to key it by', () => {
  const accounts = [{ externalId: 'no-stable-id', name: 'No stable identity available' }]
  const transactions = [{ externalAccountId: 'no-stable-id' }]
  const result = applyAccountExclusions([HASH_A], accounts, transactions)
  assert.deepEqual(result.accounts, accounts)
  assert.deepEqual(result.transactions, transactions)
})

test('applyAccountExclusions handles a missing/malformed exclusion list as "nothing excluded"', () => {
  const accounts = [{ externalId: 'e1', stableId: HASH_A }]
  assert.deepEqual(applyAccountExclusions(undefined, accounts, []).accounts, accounts)
  assert.deepEqual(applyAccountExclusions('not-an-array', accounts, []).accounts, accounts)
  assert.deepEqual(applyAccountExclusions(null, accounts, []).accounts, accounts)
})

test('applyAccountExclusions excludes multiple accounts independently', () => {
  const accounts = [
    { externalId: 'e1', stableId: HASH_A },
    { externalId: 'e2', stableId: HASH_B },
    { externalId: 'e3' },
  ]
  const result = applyAccountExclusions([HASH_A, HASH_B], accounts, [])
  assert.deepEqual(result.accounts.map((a) => a.externalId), ['e3'])
})
