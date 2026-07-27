import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession, issueState, verifySession, verifyState } from '../src/security.js'

const secret = '0123456789abcdef0123456789abcdef'

test('signed session roundtrip and tamper rejection', () => {
  const token = createSession('user-1', secret)
  assert.equal(verifySession(token, secret), 'user-1')
  assert.throws(() => verifySession(`${token}x`, secret))
})

test('consent state is provider-bound', () => {
  const state = issueState('user-1', 'paypal', secret)
  assert.equal(verifyState(state, 'paypal', secret).sub, 'user-1')
  assert.throws(() => verifyState(state, 'gocardless', secret))
})

test('consent state carries the exact consent and redirect binding', () => {
  const state = issueState('user-1', 'gocardless', secret, {
    consentId: 'consent-1',
    redirectUri: 'https://app.test/callback',
  })
  assert.deepEqual(
    (({ sub, provider, consentId, redirectUri }) => ({ sub, provider, consentId, redirectUri }))(
      verifyState(state, 'gocardless', secret),
    ),
    {
      sub: 'user-1',
      provider: 'gocardless',
      consentId: 'consent-1',
      redirectUri: 'https://app.test/callback',
    },
  )
})
