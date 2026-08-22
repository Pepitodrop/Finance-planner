import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sourceUrl = new URL('../../core/cobol/test-data-seed.cob', import.meta.url)

test('GnuCOBOL seed source owns deterministic finance records and a versioned footer', async () => {
  const source = await readFile(sourceUrl, 'utf8')
  assert.match(source, /PROGRAM-ID\. TEST-DATA-SEED/)
  assert.match(source, /DISPLAY "FP-SEED\|1"/)
  assert.match(source, /DISPLAY "END\|2\|5\|1"/)
  assert.match(source, /ACCOUNT\|seed-checking/)
  assert.match(source, /TRANSACTION\|seed-tx-001/)
  assert.match(source, /GOAL\|seed-goal-001/)
})
