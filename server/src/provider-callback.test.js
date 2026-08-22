import assert from 'node:assert/strict'
import test from 'node:test'
import { callbackHasCompletionSignal, completedConnectionMatchesState } from './provider-callback.js'

function callbackUrl(query = '') {
  return new URL(`https://finance.example/api/connectors/callback${query}`)
}

test('callbackHasCompletionSignal requires a provider code or OAuth error', () => {
  assert.equal(callbackHasCompletionSignal(callbackUrl()), false)
  assert.equal(callbackHasCompletionSignal(callbackUrl('?state=signed-state')), false)
  assert.equal(callbackHasCompletionSignal(callbackUrl('?authorization_id=abc')), false)
  assert.equal(callbackHasCompletionSignal(callbackUrl('?state=signed-state&code=abc')), true)
  assert.equal(callbackHasCompletionSignal(callbackUrl('?state=signed-state&error=access_denied')), true)
  assert.equal(callbackHasCompletionSignal(callbackUrl('?code=%20%20')), false)
  assert.equal(callbackHasCompletionSignal(callbackUrl('?error=%20')), false)
})

test('completedConnectionMatchesState accepts only the exact finalized signed attempt', () => {
  const state = {
    provider: 'enablebanking',
    consentId: 'consent-1',
    redirectUri: 'https://finance.example/connections',
  }
  const stored = {
    provider: 'enablebanking',
    consentId: 'consent-1',
    redirectUri: 'https://finance.example/connections',
    connectedAt: '2026-08-22T17:14:17.278Z',
    sessionId: 'never-exposed-to-browser',
  }

  assert.equal(completedConnectionMatchesState(stored, state, 'enablebanking'), true)
  assert.equal(completedConnectionMatchesState({ ...stored, connectedAt: undefined }, state, 'enablebanking'), false)
  assert.equal(completedConnectionMatchesState({ ...stored, consentId: 'consent-2' }, state, 'enablebanking'), false)
  assert.equal(completedConnectionMatchesState({ ...stored, redirectUri: 'https://finance.example/other' }, state, 'enablebanking'), false)
  assert.equal(completedConnectionMatchesState(stored, { ...state, provider: 'gocardless' }, 'enablebanking'), false)
  assert.equal(completedConnectionMatchesState(null, state, 'enablebanking'), false)
})
