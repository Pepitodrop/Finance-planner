import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { EnableBankingConfigError, isEnableBankingConfigured, signEnableBankingJwt } from '../src/enable-banking-jwt.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function decodeSegment(value) {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
}

function verifiesAgainst(jwt, key = publicKey) {
  const [header, payload, signature] = jwt.split('.')
  return createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(key, Buffer.from(signature, 'base64url'))
}

test('signs a well-formed RS256 JWT with the exact required claims', () => {
  const before = Math.floor(Date.now() / 1000)
  const jwt = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey })
  const after = Math.floor(Date.now() / 1000)
  const [headerB64, payloadB64, signatureB64] = jwt.split('.')
  assert.equal(jwt.split('.').length, 3)

  const header = decodeSegment(headerB64)
  assert.deepEqual(header, { typ: 'JWT', alg: 'RS256', kid: 'app-123' })

  const payload = decodeSegment(payloadB64)
  assert.equal(payload.iss, 'enablebanking.com')
  assert.equal(payload.aud, 'api.enablebanking.com')
  assert.ok(payload.iat >= before && payload.iat <= after, 'iat is a current Unix-seconds timestamp')
  assert.equal(payload.exp - payload.iat, 3600)

  assert.ok(signatureB64.length > 0)
})

test('the signature cryptographically verifies against the matching public key', () => {
  const jwt = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey })
  assert.equal(verifiesAgainst(jwt), true)
})

test('the signature does not verify against an unrelated public key', () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const jwt = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey })
  assert.equal(verifiesAgainst(jwt, other.publicKey), false)
})

test('tampering with the payload invalidates the signature', () => {
  const jwt = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey })
  const [header, payload, signature] = jwt.split('.')
  const tamperedPayload = Buffer.from(JSON.stringify({ ...decodeSegment(payload), aud: 'evil.example' })).toString('base64url')
  assert.equal(verifiesAgainst(`${header}.${tamperedPayload}.${signature}`), false)
})

test('reads the private key from ENABLE_BANKING_PRIVATE_KEY_FILE when set', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eb-key-'))
  const keyPath = join(dir, 'key.pem')
  try {
    writeFileSync(keyPath, privateKey, 'utf8')
    const jwt = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: keyPath })
    assert.equal(verifiesAgainst(jwt), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ENABLE_BANKING_PRIVATE_KEY_FILE takes precedence over ENABLE_BANKING_PRIVATE_KEY when both are set', () => {
  const other = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } })
  const dir = mkdtempSync(join(tmpdir(), 'eb-key-'))
  const keyPath = join(dir, 'key.pem')
  try {
    writeFileSync(keyPath, other.privateKey, 'utf8')
    const jwt = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: keyPath, ENABLE_BANKING_PRIVATE_KEY: privateKey })
    assert.equal(verifiesAgainst(jwt, other.publicKey), true)
    assert.equal(verifiesAgainst(jwt, publicKey), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fails closed with no key material configured at all', () => {
  assert.throws(
    () => signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123' }),
    (error) => error instanceof EnableBankingConfigError && error.code === 'enablebanking_key_invalid',
  )
})

test('fails closed on a malformed PEM string, and never includes key material in the error', () => {
  assert.throws(
    () => signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: 'not-a-real-pem-at-all' }),
    (error) => error instanceof EnableBankingConfigError && !error.message.includes('not-a-real-pem-at-all'),
  )
})

test('fails closed on an unreadable ENABLE_BANKING_PRIVATE_KEY_FILE path', () => {
  assert.throws(
    () => signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY_FILE: '/nonexistent/path/key.pem' }),
    (error) => error instanceof EnableBankingConfigError,
  )
})

test('fails closed on a missing application id even with a valid key', () => {
  assert.throws(
    () => signEnableBankingJwt({ ENABLE_BANKING_PRIVATE_KEY: privateKey }),
    (error) => error instanceof EnableBankingConfigError,
  )
})

test('isEnableBankingConfigured is a cheap presence check, not key validation', () => {
  assert.equal(isEnableBankingConfigured({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey }), true)
  assert.equal(isEnableBankingConfigured({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: 'garbage-but-present' }), true)
  assert.equal(isEnableBankingConfigured({ ENABLE_BANKING_PRIVATE_KEY: privateKey }), false)
  assert.equal(isEnableBankingConfigured({ ENABLE_BANKING_APPLICATION_ID: 'app-123' }), false)
  assert.equal(isEnableBankingConfigured({}), false)
})

test('successive calls produce different iat/exp as time advances (no stale caching)', async () => {
  const first = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey })
  await new Promise((resolve) => setTimeout(resolve, 1100))
  const second = signEnableBankingJwt({ ENABLE_BANKING_APPLICATION_ID: 'app-123', ENABLE_BANKING_PRIVATE_KEY: privateKey })
  const firstPayload = decodeSegment(first.split('.')[1])
  const secondPayload = decodeSegment(second.split('.')[1])
  assert.ok(secondPayload.iat >= firstPayload.iat)
  assert.notEqual(first, second)
})
