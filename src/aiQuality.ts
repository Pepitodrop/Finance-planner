export interface ClassificationMetrics {
  macroF1: number
  highConfidencePrecision: number
  reviewRate: number
  recurringPrecision: number
  anomalyFalsePositiveRate: number
  fallbackSuccessRate: number
}

export interface RuntimeMetrics {
  coldLoadMs: number
  warmInferenceMs: number
  peakMemoryMb: number
  modelDownloadMb: number
  failureRate: number
  offlineFallbackPassed: boolean
  corruptCacheRecoveryPassed: boolean
}

export interface ForecastMetrics {
  evaluatedWindows: number
  modelMae: number
  naiveMae: number
  uncertaintyCoverage: number
  refusesInsufficientHistory: boolean
}

export interface AiQualityReport {
  score: number
  productionReady: boolean
  passed: string[]
  failed: string[]
}

function ratioScore(value: number, target: number): number {
  return Math.max(0, Math.min(1, value / target))
}

export function assessAiQuality(
  classification: ClassificationMetrics,
  runtime: RuntimeMetrics,
  forecast: ForecastMetrics,
): AiQualityReport {
  const checks: Array<[string, boolean]> = [
    ['Macro-F1 mindestens 0,85', classification.macroF1 >= .85],
    ['Präzision bei hoher Konfidenz mindestens 0,92', classification.highConfidencePrecision >= .92],
    ['Manuelle Prüfquote höchstens 25 %', classification.reviewRate <= .25],
    ['Präzision wiederkehrender Zahlungen mindestens 0,90', classification.recurringPrecision >= .9],
    ['Anomalie-Fehlalarmquote höchstens 10 %', classification.anomalyFalsePositiveRate <= .1],
    ['Fallback-Erfolg 100 %', classification.fallbackSuccessRate === 1],
    ['Warme Inferenz unter 500 ms', runtime.warmInferenceMs < 500],
    ['Kaltstart unter 5 Sekunden', runtime.coldLoadMs < 5000],
    ['Laufzeitfehlerquote höchstens 1 %', runtime.failureRate <= .01],
    ['Offline-Fallback funktioniert', runtime.offlineFallbackPassed],
    ['Beschädigter Cache wird wiederhergestellt', runtime.corruptCacheRecoveryPassed],
    ['Mindestens sechs Forecast-Backtest-Fenster', forecast.evaluatedWindows >= 6],
    ['Forecast schlägt naive Baseline', forecast.modelMae < forecast.naiveMae],
    ['Unsicherheitsintervall deckt mindestens 80 % ab', forecast.uncertaintyCoverage >= .8],
    ['Forecast verweigert unzureichende Historie', forecast.refusesInsufficientHistory],
  ]

  const passed = checks.filter(([, ok]) => ok).map(([label]) => label)
  const failed = checks.filter(([, ok]) => !ok).map(([label]) => label)
  const classificationScore = 100 * (
    ratioScore(classification.macroF1, .85)
    + ratioScore(classification.highConfidencePrecision, .92)
    + ratioScore(.25, Math.max(classification.reviewRate, .001))
    + ratioScore(classification.recurringPrecision, .9)
    + ratioScore(.1, Math.max(classification.anomalyFalsePositiveRate, .001))
    + classification.fallbackSuccessRate
  ) / 6
  const runtimeScore = 100 * passed.filter((item) => item.includes('Inferenz') || item.includes('Kaltstart') || item.includes('Laufzeit') || item.includes('Offline') || item.includes('Cache')).length / 5
  const forecastScore = 100 * passed.filter((item) => item.includes('Forecast') || item.includes('Backtest') || item.includes('Unsicherheits')).length / 4
  const score = Math.round(classificationScore * .5 + runtimeScore * .3 + forecastScore * .2)

  return { score, productionReady: failed.length === 0 && score >= 80, passed, failed }
}
