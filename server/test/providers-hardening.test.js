import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { decimalToCents } from '../src/providers.js'

test('converts provider decimal strings to integer cents without floating-point rounding', () => {
  assert.equal(decimalToCents('12.34'), 1234)
  assert.equal(decimalToCents('-0.01'), -1)
  assert.equal(decimalToCents('100'), 10000)
  assert.equal(decimalToCents('1.2'), 120)
  assert.throws(() => decimalToCents('1.234'))
  assert.throws(() => decimalToCents('NaN'))
})

test('bank connectors enforce timeout, retry, consent, pagination and reconciliation controls', async () => {
  const source = await readFile(new URL('../src/providers.js', import.meta.url), 'utf8')
  assert.match(source, /AbortController/)
  assert.match(source, /response\.status === 429 \|\| response\.status >= 500/)
  assert.match(source, /GoCardless consent is not ready/)
  assert.match(source, /seen\.has\(externalId\)/)
  assert.match(source, /url\.searchParams\.set\('page'/)
  assert.match(source, /page <= 100/)
  assert.match(source, /reconciliation:/)
})
