import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCobolSeedOutput } from '../scripts/seed-test-account.mjs'

const VALID_OUTPUT = `FP-SEED|1
ACCOUNT|seed-checking|Test Girokonto|checking|500000|EUR
ACCOUNT|seed-savings|Test Savings|savings|250000|EUR
TRANSACTION|seed-tx-001|seed-checking|Salary|Income|income|250000|2026-08-01|true
TRANSACTION|seed-tx-002|seed-checking|Groceries|Food|expense|9000|2026-08-03|false
TRANSACTION|seed-tx-003|seed-checking|Internet|Services|expense|4999|2026-08-05|true
TRANSACTION|seed-tx-004|seed-checking|Restaurant|Leisure|expense|12000|2026-08-07|false
TRANSACTION|seed-tx-005|seed-checking|Refund|Refund|income|5000|2026-08-10|false
GOAL|seed-goal-001|Emergency fund|600000|250000|2027-08-01
END|2|5|1
`

test('COBOL seed output maps to a valid deterministic finance payload', () => {
  const payload = parseCobolSeedOutput(VALID_OUTPUT)
  assert.equal(payload.state.accounts.length, 2)
  assert.equal(payload.state.transactions.length, 5)
  assert.equal(payload.state.goals.length, 1)
  assert.deepEqual(payload.secureData, {})
  assert.equal(payload.state.accounts[0].balanceCents, 500000)
  assert.equal(payload.state.transactions[1].type, 'expense')
  assert.equal(payload.state.transactions[1].amountCents, 9000)
})

test('COBOL seed output fails closed when footer counts do not match', () => {
  assert.throws(
    () => parseCobolSeedOutput(VALID_OUTPUT.replace('END|2|5|1', 'END|2|6|1')),
    /record counts do not match/,
  )
})

test('COBOL seed output rejects unsupported formats and malformed records', () => {
  assert.throws(() => parseCobolSeedOutput(VALID_OUTPUT.replace('FP-SEED|1', 'FP-SEED|2')), /Unsupported COBOL seed format/)
  assert.throws(() => parseCobolSeedOutput(VALID_OUTPUT.replace('|9000|2026-08-03|false', '|0|2026-08-03|false')), /amountCents/)
  assert.throws(() => parseCobolSeedOutput(VALID_OUTPUT.replace('|expense|9000|', '|sideways|9000|')), /Invalid TRANSACTION type/)
})
