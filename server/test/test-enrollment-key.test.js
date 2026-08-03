import test from 'node:test'
import assert from 'node:assert/strict'
import { enrollmentKey } from '../src/test-enrollment.js'

test('enrollment keys contain only a SHA-256 digest, never the bearer token', () => {
  const token = 'sensitive-single-use-token'
  const key = enrollmentKey(token)

  assert.match(key, /^test-enrollment:[a-f0-9]{64}$/)
  assert.equal(key.includes(token), false)
  assert.equal(key, enrollmentKey(token))
  assert.notEqual(key, enrollmentKey(`${token}-different`))
})
