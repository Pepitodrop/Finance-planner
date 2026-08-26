import assert from 'node:assert/strict'
import test from 'node:test'
import { stableAccountId, STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN } from '../src/providers.js'

const KEY = 'a'.repeat(32)
const OTHER_KEY = 'b'.repeat(32)

// Found live 2026-08-26/27 (PR #154, seventh Mock ASPSP pass): account
// identity was keyed only to a provider-session-scoped externalId, so a
// reconnect of the same real bank account minted a brand-new Finance
// Planner account and doubled every historical transaction on top of it.
// stableAccountId() is the fix's core primitive -- these tests exercise it
// directly since it is pure and exported (unlike server.js's route
// handlers, which cannot be safely imported in a test: server.js calls
// server.listen() unconditionally at module load).

test('derives the same stableId for the same provider+rawIdentifier+key every time (deterministic)', () => {
  const first = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'enablebanking', 'identification-hash-1')
  const second = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'enablebanking', 'identification-hash-1')
  assert.equal(first, second)
  assert.match(first, /^[a-f0-9]{64}$/, 'a hex-encoded HMAC-SHA256 digest')
})

test('never returns the raw identifier itself -- always a derived digest', () => {
  const raw = 'DE89370400440532013000'
  const derived = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'gocardless', raw)
  assert.notEqual(derived, raw)
  assert.ok(!derived.includes(raw))
})

test('differs across providers for the same raw identifier -- no cross-provider collision', () => {
  const enableBankingId = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'enablebanking', 'same-raw-value')
  const gocardlessId = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'gocardless', 'same-raw-value')
  assert.notEqual(enableBankingId, gocardlessId)
})

test('differs across raw identifiers for the same provider -- distinct real accounts never collide', () => {
  const accountA = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'enablebanking', 'account-a-hash')
  const accountB = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'enablebanking', 'account-b-hash')
  assert.notEqual(accountA, accountB)
})

test('differs across master keys for the same input -- a leaked stableId cannot be reproduced without CONNECTOR_MASTER_KEY', () => {
  const withKeyOne = stableAccountId({ CONNECTOR_MASTER_KEY: KEY }, 'enablebanking', 'identification-hash-1')
  const withKeyTwo = stableAccountId({ CONNECTOR_MASTER_KEY: OTHER_KEY }, 'enablebanking', 'identification-hash-1')
  assert.notEqual(withKeyOne, withKeyTwo)
})

test('returns undefined (never throws) when the raw identifier is absent, empty, or malformed', () => {
  const env = { CONNECTOR_MASTER_KEY: KEY }
  assert.equal(stableAccountId(env, 'enablebanking', undefined), undefined)
  assert.equal(stableAccountId(env, 'enablebanking', null), undefined)
  assert.equal(stableAccountId(env, 'enablebanking', ''), undefined)
  assert.equal(stableAccountId(env, 'enablebanking', 42), undefined)
  assert.equal(stableAccountId(env, 'enablebanking', { toString: () => 'x' }), undefined)
  assert.equal(stableAccountId(env, 'enablebanking', 'has a space'), undefined, 'fails the bounded safe-charset pattern')
  assert.equal(stableAccountId(env, 'enablebanking', 'x'.repeat(257)), undefined, 'exceeds the 256-char bound')
})

test('returns undefined (never throws) when CONNECTOR_MASTER_KEY is missing or too short', () => {
  assert.equal(stableAccountId({}, 'enablebanking', 'identification-hash-1'), undefined)
  assert.equal(stableAccountId({ CONNECTOR_MASTER_KEY: 'too-short' }, 'enablebanking', 'identification-hash-1'), undefined)
  assert.equal(stableAccountId({ CONNECTOR_MASTER_KEY: 42 }, 'enablebanking', 'identification-hash-1'), undefined)
})

test('the raw-identifier pattern accepts hash/IBAN-shaped values and rejects anything with unsafe characters', () => {
  assert.match('DE89370400440532013000', STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN)
  assert.match('3f2a9c8e7b1d4f6a', STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN)
  assert.doesNotMatch('has a space', STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN)
  assert.doesNotMatch('has\nnewline', STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN)
  assert.doesNotMatch('', STABLE_ACCOUNT_RAW_IDENTIFIER_PATTERN)
})
