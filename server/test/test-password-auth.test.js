import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { hashTestPassword, validateTestPassword, verifyTestPassword } from '../src/test-password-auth.js'

test('test password hashes use salted scrypt and verify correctly', () => {
  const first = hashTestPassword('correct horse battery staple')
  const second = hashTestPassword('correct horse battery staple')
  assert.match(first, /^scrypt-v1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/)
  assert.notEqual(first, second)
  assert.equal(verifyTestPassword('correct horse battery staple', first), true)
  assert.equal(verifyTestPassword('wrong password', first), false)
  assert.equal(verifyTestPassword('correct horse battery staple', 'invalid'), false)
})

test('test passwords enforce a minimum length', () => {
  assert.throws(() => validateTestPassword('too-short'), /between 12 and 200/)
})

test('test-password login remains server provisioned and has no signup route', async () => {
  const router = await readFile(new URL('../src/auth-router.js', import.meta.url), 'utf8')
  const ui = await readFile(new URL('../../src/AuthGate.tsx', import.meta.url), 'utf8')
  assert.match(router, /TEST_ACCOUNT_EMAIL/)
  assert.match(router, /TEST_ACCOUNT_PASSWORD_HASH/)
  assert.match(router, /\/api\/auth\/test-password\/login/)
  assert.doesNotMatch(router, /test-password\/signup/)
  assert.match(router, /startsWith\('test:'\)/)
  assert.match(ui, /Mit Testpasswort anmelden/)
})
