import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const raw = await readFile(new URL('../ai/evaluation/transaction-categories.json', import.meta.url), 'utf8')
const dataset = JSON.parse(raw)

assert.equal(dataset.schemaVersion, 1, 'Unsupported AI evaluation schema')
assert.ok(Array.isArray(dataset.cases), 'Evaluation cases must be an array')
assert.ok(dataset.cases.length >= 12, 'At least 12 representative cases are required')

const ids = new Set()
const locales = new Set()
let abstentions = 0
for (const testCase of dataset.cases) {
  assert.equal(typeof testCase.id, 'string')
  assert.ok(testCase.id.length > 0)
  assert.ok(!ids.has(testCase.id), `Duplicate evaluation id: ${testCase.id}`)
  ids.add(testCase.id)

  assert.equal(typeof testCase.locale, 'string')
  assert.equal(typeof testCase.text, 'string')
  assert.equal(typeof testCase.expectedCategory, 'string')
  assert.ok(testCase.text.trim().length >= 4, `Evaluation text too short: ${testCase.id}`)
  locales.add(testCase.locale)
  if (testCase.expectedCategory === 'abstain') abstentions += 1
}

assert.ok(locales.has('de-DE'), 'German evaluation coverage is required')
assert.ok(locales.has('en-GB'), 'English evaluation coverage is required')
assert.ok(abstentions >= 2, 'Evaluation set must test uncertainty and abstention')
assert.doesNotMatch(raw, /\b(?:IBAN|DE\d{20}|access[_-]?token|refresh[_-]?token|password)\b/i, 'Evaluation data must not contain secrets or real banking identifiers')

console.log(`AI evaluation dataset verified: ${dataset.cases.length} cases, ${locales.size} locales, ${abstentions} abstention cases.`)
