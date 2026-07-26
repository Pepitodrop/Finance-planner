import { describe, expect, it } from 'vitest'
import { assessAiQuality } from './aiQuality'

const passing = () => assessAiQuality(
  {
    macroF1: .87,
    highConfidencePrecision: .94,
    reviewRate: .2,
    recurringPrecision: .92,
    anomalyFalsePositiveRate: .08,
    fallbackSuccessRate: 1,
  },
  {
    coldLoadMs: 4200,
    warmInferenceMs: 320,
    peakMemoryMb: 420,
    modelDownloadMb: 120,
    failureRate: .005,
    offlineFallbackPassed: true,
    corruptCacheRecoveryPassed: true,
  },
  {
    evaluatedWindows: 8,
    modelMae: 84,
    naiveMae: 110,
    uncertaintyCoverage: .84,
    refusesInsufficientHistory: true,
  },
)

describe('AI production quality gates', () => {
  it('marks a fully evidenced system production ready', () => {
    const report = passing()
    expect(report.productionReady).toBe(true)
    expect(report.score).toBeGreaterThanOrEqual(80)
    expect(report.failed).toEqual([])
  })

  it('blocks promotion when accuracy, runtime, or forecasting evidence is weak', () => {
    const report = assessAiQuality(
      {
        macroF1: .7,
        highConfidencePrecision: .8,
        reviewRate: .4,
        recurringPrecision: .75,
        anomalyFalsePositiveRate: .2,
        fallbackSuccessRate: .95,
      },
      {
        coldLoadMs: 8000,
        warmInferenceMs: 900,
        peakMemoryMb: 900,
        modelDownloadMb: 500,
        failureRate: .04,
        offlineFallbackPassed: false,
        corruptCacheRecoveryPassed: false,
      },
      {
        evaluatedWindows: 2,
        modelMae: 130,
        naiveMae: 100,
        uncertaintyCoverage: .5,
        refusesInsufficientHistory: false,
      },
    )

    expect(report.productionReady).toBe(false)
    expect(report.failed.length).toBeGreaterThan(10)
  })
})
