import test from 'node:test'
import assert from 'node:assert/strict'
import { createSession, issueState, verifySession, verifySessionClaims, verifyState } from '../src/security.js'

const secret = '0123456789abcdef0123456789abcdef'

test('signed session roundtrip and tamper rejection', () => {
  const token = createSession('user-1', secret)
  assert.equal(verifySession(token, secret), 'user-1')
  assert.throws(() => verifySession(`${token}x`, secret))
})

test('signed sessions preserve millisecond issuance precision', () => {
  const claims = verifySessionClaims(createSession('user-1', secret), secret)
  assert.ok(Number.isSafeInteger(claims.iatMs))
  assert.equal(Math.floor(claims.iatMs / 1000), claims.iat)
})

// verifyState() no longer takes an "expected provider" argument (fixed
// 2026-08-21, see the redirect_uri architecture fix in providers.js/
// server.js): the provider identity lives inside the signed payload itself
// and is trustworthy as soon as the signature verifies, so there is nothing
// external left to compare it against inside verifyState() -- a caller that
// wants a strict binding check (like server.js's start() self-check, or
// google-subscriptions-router.js) performs it itself against the returned
// `.provider` field. This is what lets a callback route derive which
// provider a return belongs to directly from the verified state, instead of
// from a separate, unauthenticated query parameter a provider's own
// redirect may or may not still carry (Enable Banking's doesn't).
test('consent state carries the provider identity, verifiable directly from the signed payload', () => {
  const state = issueState('user-1', 'paypal', secret)
  assert.equal(verifyState(state, secret).sub, 'user-1')
  assert.equal(verifyState(state, secret).provider, 'paypal')
})

test('a tampered signature is rejected regardless of which provider the payload claims', () => {
  const state = issueState('user-1', 'paypal', secret)
  assert.throws(() => verifyState(`${state}x`, secret))
})

test('consent state carries the exact consent and redirect binding', () => {
  const state = issueState('user-1', 'gocardless', secret, {
    consentId: 'consent-1',
    redirectUri: 'https://app.test/callback',
  })
  assert.deepEqual(
    (({ sub, provider, consentId, redirectUri }) => ({ sub, provider, consentId, redirectUri }))(
      verifyState(state, secret),
    ),
    {
      sub: 'user-1',
      provider: 'gocardless',
      consentId: 'consent-1',
      redirectUri: 'https://app.test/callback',
    },
  )
})
