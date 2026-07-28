import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const raw = await readFile(new URL('../ai/model-lock.json', import.meta.url), 'utf8')
const lock = JSON.parse(raw)

assert.equal(lock.schemaVersion, 1, 'Unsupported model-lock schema')
assert.match(lock.reviewedAt, /^\d{4}-\d{2}-\d{2}$/)
assert.ok(Array.isArray(lock.models) && lock.models.length > 0, 'At least one governed model is required')

const ids = new Set()
for (const model of lock.models) {
  assert.equal(typeof model.id, 'string')
  assert.ok(!ids.has(model.id), `Duplicate model id: ${model.id}`)
  ids.add(model.id)
  assert.match(model.revision, /^[0-9a-f]{40}$/, `${model.id} must use an immutable 40-character revision`)
  assert.ok(['Apache-2.0', 'MIT', 'BSD-3-Clause'].includes(model.license), `${model.id} uses an unreviewed licence`)
  assert.equal(model.weightsBundled, false, `${model.id} weights must not be committed to this repository`)
  if (model.integrationStatus === 'integrated') {
    assert.equal(model.productionEligible, true, `${model.id} is integrated but not production eligible`)
    assert.equal(typeof model.providerAlias, 'string')
    assert.ok(model.providerAlias.startsWith(`${model.id}:`) || model.providerAlias === model.id)
  }
}

assert.doesNotMatch(raw, /(?:token|password|secret)\s*[=:]\s*["'][^"']+/i, 'Model lock must not contain credentials')
console.log(`AI model lock verified: ${lock.models.length} governed model(s).`)
