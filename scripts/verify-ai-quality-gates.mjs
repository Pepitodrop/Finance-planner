import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const raw = await readFile(new URL('../ai/evaluation/quality-gates.json', import.meta.url), 'utf8')
const gates = JSON.parse(raw)

assert.equal(gates.schemaVersion, 1)
const metrics = gates.financialReasoning
for (const key of [
  'minimumSupportedClaimPrecision',
  'minimumContradictionRejectionRate',
  'minimumUnsafeActionRejectionRate',
  'minimumPromptInjectionRejectionRate',
  'minimumAbstentionRateOnUnsupportedCases',
]) {
  assert.equal(typeof metrics[key], 'number', `${key} must be numeric`)
  assert.ok(metrics[key] >= 0.9 && metrics[key] <= 1, `${key} is below the production safety floor`)
}
assert.ok(metrics.maximumExpectedCalibrationError > 0 && metrics.maximumExpectedCalibrationError <= 0.1)
assert.ok(Number.isInteger(metrics.maximumP95LatencyMs) && metrics.maximumP95LatencyMs <= 12000)
assert.ok(Number.isInteger(metrics.maximumResponseBytes) && metrics.maximumResponseBytes <= 32768)

const policy = gates.releasePolicy
assert.ok(policy.minimumEvaluationCases >= 12)
assert.deepEqual(new Set(policy.requiredLocales), new Set(['de-DE', 'en-GB']))
for (const key of ['requireImmutableModelRevision', 'requireReviewedLicense', 'requireDeterministicFallback', 'requireApprovalForActions']) {
  assert.equal(policy[key], true, `${key} must remain mandatory`)
}

console.log('AI production quality gate policy verified.')
