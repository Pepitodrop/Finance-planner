const DEFAULT_THRESHOLDS = Object.freeze({
  precision: 0.9,
  recall: 0.85,
  abstentionSafety: 1,
  calibrationError: 0.15,
  latencyP95Ms: 12_000,
})

const DEFAULT_MINIMUM_COVERAGE = Object.freeze({
  cases: 4,
  labelledSignals: 1,
  abstentionCases: 1,
  calibrationSamples: 1,
  latencySamples: 1,
})

function percentile(values, ratio) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function signalKey(signal) {
  return `${signal.type}:${signal.severity}`
}

export function evaluateAiCases(cases, thresholds = DEFAULT_THRESHOLDS, minimumCoverage = DEFAULT_MINIMUM_COVERAGE) {
  if (!Array.isArray(cases)) throw new TypeError('AI evaluation cases must be an array')

  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let safeAbstentions = 0
  let requiredAbstentions = 0
  let calibrationTotal = 0
  let calibrationCount = 0
  let labelledSignals = 0
  const latencies = []

  for (const item of cases) {
    const expected = new Set((item.expectedSignals || []).map(signalKey))
    const actual = new Set((item.actualSignals || []).map(signalKey))
    labelledSignals += expected.size
    for (const key of actual) expected.has(key) ? truePositive++ : falsePositive++
    for (const key of expected) if (!actual.has(key)) falseNegative++

    if (item.mustAbstain) {
      requiredAbstentions++
      if (item.abstained === true) safeAbstentions++
    }

    if (Number.isFinite(item.confidence) && Number.isFinite(item.correctness)) {
      calibrationTotal += Math.abs(item.confidence - item.correctness)
      calibrationCount++
    }
    if (Number.isFinite(item.latencyMs)) latencies.push(item.latencyMs)
  }

  const coverage = {
    cases: cases.length,
    labelledSignals,
    abstentionCases: requiredAbstentions,
    calibrationSamples: calibrationCount,
    latencySamples: latencies.length,
  }
  const coverageFailures = Object.entries(minimumCoverage).flatMap(([key, minimum]) =>
    coverage[key] >= minimum ? [] : [`coverage.${key}=${coverage[key]} below minimum ${minimum}`],
  )

  const precision = truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive)
  const recall = truePositive + falseNegative === 0 ? null : truePositive / (truePositive + falseNegative)
  const abstentionSafety = requiredAbstentions === 0 ? null : safeAbstentions / requiredAbstentions
  const calibrationError = calibrationCount === 0 ? null : calibrationTotal / calibrationCount
  const latencyP95Ms = percentile(latencies, 0.95)
  const metrics = {
    precision: precision === null ? null : Number(precision.toFixed(3)),
    recall: recall === null ? null : Number(recall.toFixed(3)),
    abstentionSafety: abstentionSafety === null ? null : Number(abstentionSafety.toFixed(3)),
    calibrationError: calibrationError === null ? null : Number(calibrationError.toFixed(3)),
    latencyP95Ms,
  }
  const thresholdFailures = Object.entries(thresholds).flatMap(([key, value]) => {
    const actual = metrics[key]
    if (!Number.isFinite(actual)) return [`${key}=unavailable because evaluation coverage is missing`]
    const passed = key === 'calibrationError' || key === 'latencyP95Ms' ? actual <= value : actual >= value
    return passed ? [] : [`${key}=${actual} failed threshold ${value}`]
  })
  const failures = [...coverageFailures, ...thresholdFailures]
  return {
    metrics,
    coverage,
    minimumCoverage: { ...minimumCoverage },
    thresholds: { ...thresholds },
    passed: failures.length === 0,
    failures,
  }
}

export function detectAiDrift(current, baseline, limits = {}) {
  const allowed = {
    precisionDrop: limits.precisionDrop ?? 0.05,
    recallDrop: limits.recallDrop ?? 0.05,
    calibrationIncrease: limits.calibrationIncrease ?? 0.05,
    latencyIncreaseRatio: limits.latencyIncreaseRatio ?? 0.5,
  }
  const changes = {
    precisionDrop: Number((baseline.precision - current.precision).toFixed(3)),
    recallDrop: Number((baseline.recall - current.recall).toFixed(3)),
    calibrationIncrease: Number((current.calibrationError - baseline.calibrationError).toFixed(3)),
    latencyIncreaseRatio: baseline.latencyP95Ms > 0 ? Number(((current.latencyP95Ms - baseline.latencyP95Ms) / baseline.latencyP95Ms).toFixed(3)) : 0,
  }
  const alerts = Object.entries(allowed).flatMap(([key, value]) => changes[key] > value ? [`${key}=${changes[key]} exceeds ${value}`] : [])
  return { drifted: alerts.length > 0, changes, limits: allowed, alerts }
}

export { DEFAULT_MINIMUM_COVERAGE, DEFAULT_THRESHOLDS }
