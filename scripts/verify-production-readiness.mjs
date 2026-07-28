import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const strict = process.argv.includes('--strict') || process.env.RELEASE_READINESS_STRICT === 'true'
const root = resolve(new URL('..', import.meta.url).pathname)
const evidencePath = resolve(root, 'config/production-readiness-evidence.json')
const modelLockPath = resolve(root, 'config/ai-model-lock.json')
const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
const modelLock = JSON.parse(await readFile(modelLockPath, 'utf8'))

assert.equal(evidence.schemaVersion, 1, 'Unsupported readiness evidence schema')
assert.equal(modelLock.schemaVersion, 1, 'Unsupported model lock schema')
assert.ok(evidence.gates && typeof evidence.gates === 'object', 'Readiness gates are required')
assert.ok(Array.isArray(modelLock.models) && modelLock.models.length >= 1, 'At least one governed model is required')

const allowedStatuses = new Set(['pending', 'partial', 'verified', 'not-applicable'])
const pending = []
for (const [name, gate] of Object.entries(evidence.gates)) {
  assert.ok(allowedStatuses.has(gate.status), `Invalid status for ${name}`)
  assert.ok(Array.isArray(gate.evidence), `Evidence list is required for ${name}`)
  for (const relativePath of gate.evidence) {
    assert.equal(typeof relativePath, 'string', `Evidence path must be a string for ${name}`)
    assert.ok(!relativePath.startsWith('/') && !relativePath.includes('..'), `Unsafe evidence path for ${name}`)
    await access(resolve(root, relativePath))
  }
  if (gate.status !== 'verified' && gate.status !== 'not-applicable') pending.push(name)
}

const ids = new Set()
for (const model of modelLock.models) {
  assert.equal(typeof model.id, 'string')
  assert.ok(model.id.length > 0 && !ids.has(model.id), `Invalid or duplicate model id: ${model.id}`)
  ids.add(model.id)
  assert.equal(typeof model.revision, 'string')
  assert.equal(typeof model.license, 'string')
  assert.equal(typeof model.productionEnabled, 'boolean')
  if (model.productionEnabled) {
    assert.notEqual(model.revision, 'PIN_REQUIRED_BEFORE_PRODUCTION', `${model.id} requires an immutable revision`)
    assert.notEqual(model.license, 'VERIFY_ON_MODEL_CARD', `${model.id} requires a verified licence`)
  }
}

if (strict) assert.deepEqual(pending, [], `Release readiness is blocked by: ${pending.join(', ')}`)
console.log(`Production readiness manifest valid. ${pending.length} gate(s) remain pending or partial.${strict ? ' Strict release gate passed.' : ''}`)
