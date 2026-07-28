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
assert.ok(Array.isArray(evidence.notApplicablePolicy?.allowedGates), 'notApplicablePolicy.allowedGates is required')
assert.ok(Array.isArray(modelLock.models) && modelLock.models.length >= 1, 'At least one governed model is required')

const allowedStatuses = new Set(['pending', 'partial', 'verified', 'not-applicable'])
const allowedNotApplicable = new Set(evidence.notApplicablePolicy.allowedGates)
const pending = []
for (const [name, gate] of Object.entries(evidence.gates)) {
  assert.ok(allowedStatuses.has(gate.status), `Invalid status for ${name}`)
  assert.ok(Array.isArray(gate.evidence), `Evidence list is required for ${name}`)
  for (const relativePath of gate.evidence) {
    assert.equal(typeof relativePath, 'string', `Evidence path must be a string for ${name}`)
    assert.ok(!relativePath.startsWith('/') && !relativePath.includes('..'), `Unsafe evidence path for ${name}`)
    await access(resolve(root, relativePath))
  }

  if (gate.status === 'verified') {
    assert.ok(gate.evidence.length > 0, `Verified gate ${name} requires durable evidence`)
    assert.equal(typeof gate.approvedBy, 'string', `Verified gate ${name} requires approvedBy`)
    assert.ok(gate.approvedBy.trim().length >= 2, `Verified gate ${name} requires an accountable approver`)
    assert.match(String(gate.reviewedAt || ''), /^\d{4}-\d{2}-\d{2}$/, `Verified gate ${name} requires reviewedAt as YYYY-MM-DD`)
  }

  if (gate.status === 'not-applicable') {
    assert.ok(allowedNotApplicable.has(name), `Gate ${name} is mandatory and cannot be marked not-applicable`)
    assert.ok(gate.evidence.length > 0, `Not-applicable gate ${name} requires supporting evidence`)
    assert.equal(typeof gate.justification, 'string', `Not-applicable gate ${name} requires justification`)
    assert.ok(gate.justification.trim().length >= 30, `Not-applicable gate ${name} requires a substantive justification`)
    assert.equal(typeof gate.approvedBy, 'string', `Not-applicable gate ${name} requires approvedBy`)
    assert.ok(gate.approvedBy.trim().length >= 2, `Not-applicable gate ${name} requires an accountable approver`)
    assert.match(String(gate.reviewedAt || ''), /^\d{4}-\d{2}-\d{2}$/, `Not-applicable gate ${name} requires reviewedAt as YYYY-MM-DD`)
  }

  if (gate.status !== 'verified' && gate.status !== 'not-applicable') pending.push(name)
}

for (const gateName of allowedNotApplicable) {
  assert.ok(Object.hasOwn(evidence.gates, gateName), `Unknown not-applicable gate in policy: ${gateName}`)
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
