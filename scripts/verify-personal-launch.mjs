import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const readJson = async (relativePath) => JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'))

const launch = await readJson('config/personal-launch.json')
const modelLock = await readJson(launch.ai.modelLock)
const baseline = await readJson(launch.ai.evaluationBaseline)
const evaluation = await readJson('ai/evaluation/transaction-categories.json')

assert.equal(launch.schemaVersion, 1)
assert.match(launch.launchDate, /^\d{4}-\d{2}-\d{2}$/)
assert.equal(launch.mode, 'single-user-personal-pilot')
assert.equal(launch.currency, 'EUR')
assert.ok(launch.locales.includes('de-DE'))
assert.ok(launch.ai.requireExplicitExternalAiConsent)
assert.ok(launch.ai.requireDeterministicFallback)
assert.ok(launch.ai.requireHumanApprovalForActions)

const governedModel = modelLock.models.find((model) => model.id === baseline.modelId)
assert.ok(governedModel, `Baseline model ${baseline.modelId} is missing from the model lock`)
assert.equal(governedModel.revision, baseline.modelRevision)
assert.equal(governedModel.productionEligible, true)
assert.equal(governedModel.integrationStatus, 'integrated')
assert.match(governedModel.revision, /^[0-9a-f]{40}$/)

const requirements = launch.launchRequirements
const metrics = baseline.metrics
const coverage = baseline.coverage
assert.ok(metrics.precision >= requirements.minimumPrecision)
assert.ok(metrics.recall >= requirements.minimumRecall)
assert.equal(metrics.safeAbstentionRate, requirements.requiredSafeAbstentionRate)
assert.ok(metrics.calibrationError <= requirements.maximumCalibrationError)
assert.ok(metrics.p95LatencyMs <= requirements.maximumP95LatencyMs)
assert.ok(coverage.cases >= requirements.minimumEvaluationCases)
assert.ok(coverage.germanCases >= requirements.minimumGermanCases)
assert.ok(coverage.englishCases >= requirements.minimumEnglishCases)
assert.ok(coverage.abstentionCases >= requirements.minimumAbstentionCases)
assert.ok(coverage.locales.includes('de-DE') && coverage.locales.includes('en-GB'))

assert.ok(Array.isArray(evaluation.cases) && evaluation.cases.length >= requirements.minimumEvaluationCases)
const actualGerman = evaluation.cases.filter((item) => item.locale === 'de-DE').length
const actualEnglish = evaluation.cases.filter((item) => item.locale === 'en-GB').length
const actualAbstentions = evaluation.cases.filter((item) => item.expectedCategory === 'abstain').length
assert.ok(actualGerman >= requirements.minimumGermanCases)
assert.ok(actualEnglish >= requirements.minimumEnglishCases)
assert.ok(actualAbstentions >= requirements.minimumAbstentionCases)

const allowed = new Set(launch.telemetry.allowedFields)
const forbidden = new Set(launch.telemetry.forbiddenFields)
assert.equal(launch.telemetry.privacyMode, 'aggregate-only')
assert.ok(launch.telemetry.retentionDays > 0 && launch.telemetry.retentionDays <= 30)
for (const field of forbidden) assert.ok(!allowed.has(field), `Forbidden telemetry field is allowlisted: ${field}`)
for (const requiredField of ['modelRevision', 'locale', 'source', 'abstained', 'latencyMs']) {
  assert.ok(allowed.has(requiredField), `Required telemetry field is missing: ${requiredField}`)
}

const sensitivePattern = /(?:prompt|description|account|iban|credential|token|password|secret)/i
for (const field of allowed) assert.doesNotMatch(field, sensitivePattern, `Sensitive telemetry field is not allowed: ${field}`)

if (process.argv.includes('--runtime')) {
  assert.ok(process.env.HF_TOKEN, 'HF_TOKEN is required for hosted AI runtime validation')
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for personal launch runtime validation')
  assert.ok(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32, 'SESSION_SECRET must contain at least 32 characters')
}

console.log(`Personal launch verified for ${launch.launchDate}: ${coverage.cases} baseline cases, model ${baseline.modelId}@${baseline.modelRevision.slice(0, 12)}, aggregate-only telemetry.`)
