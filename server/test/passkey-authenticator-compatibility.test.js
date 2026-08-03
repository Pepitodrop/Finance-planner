import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('../src/auth-router.js', import.meta.url), 'utf8')

test('passkey registration does not force a platform authenticator', () => {
  assert.equal(source.includes("authenticatorAttachment: 'platform'"), false)
  assert.equal(source.includes('authenticatorAttachment'), false)
})

test('test-account and authenticated registration still require discoverable verified passkeys', () => {
  const requiredSelection = "authenticatorSelection: { residentKey: 'required', userVerification: 'required' }"
  assert.equal(source.split(requiredSelection).length - 1, 2)
})
