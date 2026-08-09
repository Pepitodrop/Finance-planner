import assert from 'node:assert/strict'
import test from 'node:test'
import { hashPassword, normalizeDisplayName, normalizeEmail, validatePassword, verifyPassword } from '../src/password-auth.js'

test('email/password credentials use normalized email and salted scrypt hashes', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com')
  assert.equal(normalizeDisplayName('  Demo   User  ', 'person@example.com'), 'Demo User')
  assert.equal(normalizeDisplayName('', 'person@example.com'), 'person')

  const first = hashPassword('correct horse battery staple')
  const second = hashPassword('correct horse battery staple')
  assert.match(first, /^scrypt-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
  assert.notEqual(first, second)
  assert.equal(verifyPassword('correct horse battery staple', first), true)
  assert.equal(verifyPassword('not the password', first), false)
})

test('email/password validation rejects malformed identifiers and short passwords', () => {
  assert.throws(() => normalizeEmail('not-an-email'), /valid email address/)
  assert.throws(() => validatePassword('too-short'), /between 12 and 200/)
})
