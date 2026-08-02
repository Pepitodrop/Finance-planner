const DAY_MS = 86_400_000

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function finite(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function robustWeeklyTrend(values) {
  if (!Array.isArray(values) || values.length < 4) {
    return { slopeCentsPerWeek: 0, direction: 'insufficient-data', strength: 0 }
  }
  const slopes = []
  for (let left = 0; left < values.length - 1; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const a = finite(values[left])
      const b = finite(values[right])
      slopes.push((b - a) / (right - left))
    }
  }
  slopes.sort((a, b) => a - b)
  const middle = Math.floor(slopes.length / 2)
  const slope = slopes.length % 2 ? slopes[middle] : (slopes[middle - 1] + slopes[middle]) / 2
  const baseline = Math.max(1, values.reduce((sum, value) => sum + Math.abs(finite(value)), 0) / values.length)
  const strength = clamp(Math.abs(slope) / baseline)
  return {
    slopeCentsPerWeek: Math.round(slope),
    direction: strength < 0.03 ? 'stable' : slope > 0 ? 'increasing' : 'decreasing',
    strength: Number(strength.toFixed(3)),
  }
}

export function intelligenceFreshness(latestEventAt, now = new Date()) {
  const latest = Date.parse(latestEventAt)
  const current = new Date(now).getTime()
  if (!Number.isFinite(latest) || !Number.isFinite(current) || latest > current) {
    return { ageDays: null, level: 'unknown', confidenceMultiplier: 0, abstain: true }
  }
  const ageDays = Math.floor((current - latest) / DAY_MS)
  if (ageDays <= 7) return { ageDays, level: 'fresh', confidenceMultiplier: 1, abstain: false }
  if (ageDays <= 30) return { ageDays, level: 'aging', confidenceMultiplier: 0.85, abstain: false }
  if (ageDays <= 60) return { ageDays, level: 'stale', confidenceMultiplier: 0.55, abstain: false }
  return { ageDays, level: 'expired', confidenceMultiplier: 0, abstain: true }
}

export function calibrateIntelligenceQuality(input) {
  const baseConfidence = clamp(finite(input?.baseConfidence))
  const coverage = clamp(finite(input?.coverage))
  const sampleScore = clamp(finite(input?.sampleScore))
  const stabilityScore = clamp(finite(input?.stabilityScore))
  const freshness = intelligenceFreshness(input?.latestEventAt, input?.now)
  const recurringCoverage = clamp(finite(input?.recurringCoverage, 1))
  const providerCompleteness = clamp(finite(input?.providerCompleteness, 1))

  const evidenceScore = (
    coverage * 0.28 +
    sampleScore * 0.22 +
    stabilityScore * 0.2 +
    recurringCoverage * 0.12 +
    providerCompleteness * 0.18
  )
  const calibratedConfidence = clamp(Math.min(baseConfidence, evidenceScore) * freshness.confidenceMultiplier, 0, 0.97)
  const reasons = []
  if (coverage < 0.5) reasons.push('insufficient_history_coverage')
  if (sampleScore < 0.4) reasons.push('insufficient_sample_size')
  if (stabilityScore < 0.35) reasons.push('high_volatility')
  if (recurringCoverage < 0.5) reasons.push('weak_recurring_classification')
  if (providerCompleteness < 0.8) reasons.push('incomplete_provider_data')
  if (freshness.level !== 'fresh') reasons.push(`data_${freshness.level}`)

  const abstain = freshness.abstain || calibratedConfidence < 0.35 || coverage < 0.25 || sampleScore < 0.2
  return {
    calibratedConfidence: Number(calibratedConfidence.toFixed(3)),
    evidenceScore: Number(evidenceScore.toFixed(3)),
    abstain,
    reasons,
    freshness,
    policyVersion: 'intelligence-calibration-v3',
  }
}

export function evaluateForecastOutcome({ predictedLow, predictedHigh, actual, previousCalibrationError = 0 }) {
  const low = finite(predictedLow)
  const high = finite(predictedHigh)
  const observed = finite(actual)
  if (low < 0 || high < low || observed < 0) throw new Error('Forecast outcome values are invalid.')
  const covered = observed >= low && observed <= high
  const midpoint = (low + high) / 2
  const relativeError = Math.abs(observed - midpoint) / Math.max(1, observed)
  const calibrationError = clamp(finite(previousCalibrationError) * 0.8 + relativeError * 0.2)
  return {
    covered,
    relativeError: Number(relativeError.toFixed(4)),
    calibrationError: Number(calibrationError.toFixed(4)),
    requiresWiderRange: !covered || calibrationError > 0.2,
  }
}
