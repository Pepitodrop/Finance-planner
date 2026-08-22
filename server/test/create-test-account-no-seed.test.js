import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('test-account provisioning is identity-only', async () => {
  const source = await readFile(new URL('../scripts/create-test-account.mjs', import.meta.url), 'utf8')
  assert.equal(source.includes('TEST_ACCOUNT_SEED_FILE'), false)
  assert.equal(source.includes('encryptCloudPayload'), false)
  assert.equal(source.includes('user_finance_state'), false)
  assert.match(source, /financialDataSeeded:\s*false/)
})
