import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { createHuggingFaceChatTransport } from '../server/src/huggingFaceClient.js'

const RUNTIME_MODEL_ALIAS = 'Qwen/Qwen3-4B-Thinking-2507:fastest'
const RUNTIME_MODEL_REVISION = '768f209d9ea81521153ed38c47d515654e938aea'
const RUNTIME_SYSTEM_MESSAGE = 'Return only a JSON object. Do not provide financial advice or request personal data.'
const RUNTIME_USER_MESSAGE = 'Synthetic health check: return {"status":"ok","safe":true}.'

const readJson = async (relativePath) => JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'))
const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

const launch = await readJson('config/personal-launch.json')
const modelLock = await readJson(launch.ai.modelLock)
const baseline = await readJson(launch.ai.evaluationBaseline)
const evaluation = await readJson('ai/evaluation/transaction-categories.json')

assert.equal(launch.schemaVersion, 1)
assert.match(launch.launchDate, /^\d{4}-\d{2}-\d{2}$/)
assert.equal(launch.mode, 'single-user-personal-pilot')
assert.equal(launch.currency, 'EUR')
assert.ok(launch.locales.includes('de-DE'))
assert.equal(launch.ai.enabledByDefault, false, 'Hosted AI must remain disabled until runtime validation passes')
assert.equal(launch.ai.enableOnlyAfterRuntimeValidation, true)
assert.ok(launch.ai.minimumHostedSamples >= 5)
assert.equal(launch.ai.maximumHostedErrorRate, 0)
assert.ok(launch.ai.requireExplicitExternalAiConsent)
assert.ok(launch.ai.requireDeterministicFallback)
assert.ok(launch.ai.requireHumanApprovalForActions)

const governedModel = modelLock.models.find((model) => model.id === baseline.modelId)
assert.ok(governedModel, `Baseline model ${baseline.modelId} is missing from the model lock`)
assert.equal(governedModel.revision, baseline.modelRevision)
assert.equal(governedModel.productionEligible, true)
assert.equal(governedModel.integrationStatus, 'integrated')
assert.match(governedModel.revision, /^[0-9a-f]{40}$/)
assert.equal(governedModel.providerAlias, RUNTIME_MODEL_ALIAS, 'Runtime model alias must match the reviewed compiled constant')
assert.equal(governedModel.revision, RUNTIME_MODEL_REVISION, 'Runtime model revision must match the reviewed compiled constant')
assert.equal(baseline.measurement.qualityGateScript, 'scripts/verify-ai-quality-gates.mjs')
assert.equal(baseline.measurement.evaluationDataset, 'ai/evaluation/transaction-categories.json')
assert.equal(baseline.measurement.hostedProviderLatencyValidated, false)

const requirements = launch.launchRequirements
const metrics = baseline.metrics
const coverage = baseline.coverage
assert.ok(metrics.precision >= requirements.minimumPrecision)
assert.ok(metrics.recall >= requirements.minimumRecall)
assert.equal(metrics.safeAbstentionRate, requirements.requiredSafeAbstentionRate)
assert.ok(metrics.calibrationError <= requirements.maximumCalibrationError)
assert.ok(metrics.p95LatencyMs <= requirements.maximumP95LatencyMs)

assert.ok(Array.isArray(evaluation.cases) && evaluation.cases.length >= requirements.minimumEvaluationCases)
const actualGerman = evaluation.cases.filter((item) => item.locale === 'de-DE').length
const actualEnglish = evaluation.cases.filter((item) => item.locale === 'en-GB').length
const actualAbstentions = evaluation.cases.filter((item) => item.expectedCategory === 'abstain').length
assert.equal(coverage.cases, evaluation.cases.length, 'Baseline case count must match the checked-in evaluation dataset')
assert.equal(coverage.germanCases, actualGerman, 'Baseline German coverage must match the checked-in evaluation dataset')
assert.equal(coverage.englishCases, actualEnglish, 'Baseline English coverage must match the checked-in evaluation dataset')
assert.equal(coverage.abstentionCases, actualAbstentions, 'Baseline abstention coverage must match the checked-in evaluation dataset')
assert.ok(actualGerman >= requirements.minimumGermanCases)
assert.ok(actualEnglish >= requirements.minimumEnglishCases)
assert.ok(actualAbstentions >= requirements.minimumAbstentionCases)
assert.ok(coverage.locales.includes('de-DE') && coverage.locales.includes('en-GB'))

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
  assert.doesNotThrow(() => new URL(process.env.DATABASE_URL), 'DATABASE_URL must be a valid URL')
  assert.ok(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32, 'SESSION_SECRET must contain at least 32 characters')
  assert.ok(new Set(process.env.SESSION_SECRET).size >= 12, 'SESSION_SECRET must have sufficient character diversity')
  assert.notEqual(process.env.EXTERNAL_AI_ENABLED, 'true', 'Keep EXTERNAL_AI_ENABLED disabled while validating the provider')

  const transport = createHuggingFaceChatTransport({
    token: process.env.HF_TOKEN,
    timeoutMs: requirements.maximumP95LatencyMs,
  })
  const latencies = []
  const errors = []
  for (let index = 0; index < launch.ai.minimumHostedSamples; index += 1) {
    const started = performance.now()
    try {
      const content = await transport.chatCompletion({
        model: RUNTIME_MODEL_ALIAS,
        revision: RUNTIME_MODEL_REVISION,
        maxTokens: 80,
        messages: [
          { role: 'system', content: RUNTIME_SYSTEM_MESSAGE },
          { role: 'user', content: RUNTIME_USER_MESSAGE },
        ],
      })
      const parsed = JSON.parse(content)
      assert.equal(parsed.status, 'ok')
      assert.equal(parsed.safe, true)
      latencies.push(Math.round(performance.now() - started))
    } catch (error) {
      errors.push({ sample: index + 1, message: error instanceof Error ? error.name : 'HostedInferenceError' })
    }
  }

  const samples = launch.ai.minimumHostedSamples
  const errorRate = errors.length / samples
  assert.ok(errorRate <= launch.ai.maximumHostedErrorRate, `Hosted AI error rate ${errorRate} exceeds ${launch.ai.maximumHostedErrorRate}`)
  assert.equal(latencies.length, samples, 'Every hosted validation sample must succeed')
  const p95LatencyMs = percentile(latencies, 0.95)
  assert.ok(p95LatencyMs <= requirements.maximumP95LatencyMs, `Hosted AI p95 latency ${p95LatencyMs}ms exceeds ${requirements.maximumP95LatencyMs}ms`)

  const evidence = {
    schemaVersion: 1,
    validatedAt: new Date().toISOString(),
    launchDate: launch.launchDate,
    environment: launch.mode,
    modelId: governedModel.id,
    modelRevision: RUNTIME_MODEL_REVISION,
    providerAlias: RUNTIME_MODEL_ALIAS,
    samples,
    successfulSamples: latencies.length,
    errorRate,
    p95LatencyMs,
    maximumP95LatencyMs: requirements.maximumP95LatencyMs,
    externalAiMayBeEnabled: true,
  }
  const evidenceUrl = new URL(`../${launch.ai.runtimeEvidencePath}`, import.meta.url)
  await mkdir(new URL('.', evidenceUrl), { recursive: true })
  await writeFile(evidenceUrl, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  console.log(`Hosted AI runtime validation passed: ${samples} samples, p95 ${p95LatencyMs}ms. Evidence written to ${launch.ai.runtimeEvidencePath}.`)
}

console.log(`Personal launch verified for ${launch.launchDate}: ${coverage.cases} checked cases, model ${baseline.modelId}@${baseline.modelRevision.slice(0, 12)}, aggregate-only telemetry.`)
