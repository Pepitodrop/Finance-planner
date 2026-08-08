import { assessAiRuntimeReadiness } from './aiRuntimeReadiness'
import type { AiQualityReport } from './aiQuality'
import type { BankConnectionReadiness } from './bankConnection'
import type { AppState } from './types'

export interface SmartnessDimension {
  key: 'data' | 'personalization' | 'prediction' | 'models' | 'bank' | 'explainability' | 'safety'
  label: string
  score: number
  evidence: string
}

export interface SmartnessAssessment {
  overall: number
  level: 'basic' | 'adaptive' | 'advanced'
  dimensions: SmartnessDimension[]
  nextMilestone: string
  evidenceComplete: boolean
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function assessSmartness(
  state: AppState,
  learnedDecisions: number,
  quality?: AiQualityReport,
  bank?: BankConnectionReadiness,
): SmartnessAssessment {
  const transactions = state.transactions.length
  const categories = new Set(state.transactions.map((item) => item.category).filter(Boolean)).size
  const recurring = state.transactions.filter((item) => item.recurring).length
  const months = new Set(state.transactions.map((item) => item.date.slice(0, 7))).size
  const goals = state.goals.length
  const runtime = assessAiRuntimeReadiness()
  const evidenceComplete = Boolean(quality?.productionReady)

  const dimensions: SmartnessDimension[] = [
    {
      key: 'data',
      label: 'Data',
      score: clamp(transactions * 1.2 + categories * 4 + months * 5),
      evidence: `${transactions} transactions, ${categories} categories, and ${months} months of history`,
    },
    {
      key: 'personalization',
      label: 'Personalization',
      score: clamp(20 + learnedDecisions * 3 + recurring * 2),
      evidence: `${learnedDecisions} confirmed learning decisions and ${recurring} recurring transactions`,
    },
    {
      key: 'prediction',
      label: 'Prediction',
      score: clamp(15 + months * 9 + Math.min(transactions, 60) * .5),
      evidence: months >= 6 ? 'Multi-month patterns can be evaluated; a production release additionally requires backtests.' : 'Several more months of history are still needed for stable predictions',
    },
    {
      key: 'models',
      label: 'Models',
      score: quality ? Math.round((runtime.score + quality.score) / 2) : Math.min(runtime.score, 72),
      evidence: quality
        ? `${runtime.evidence} Measured quality gates: ${quality.passed.length} passed, ${quality.failed.length} open.`
        : `${runtime.evidence} Accuracy, runtime, and forecast measurements are still missing.`,
    },
    {
      key: 'bank',
      label: 'Bank',
      score: bank?.score ?? 5,
      evidence: bank
        ? `${bank.passed.length} bank integration checks passed, ${bank.failed.length} open.`
        : 'No verified, consent-based bank connection exists yet.',
    },
    {
      key: 'explainability',
      label: 'Explainability',
      score: 82,
      evidence: 'Rules, model source, uncertainty, and alternatives are reported separately',
    },
    {
      key: 'safety',
      label: 'Safety',
      score: goals > 0 ? 88 : 84,
      evidence: 'Financial actions stay approval-required and never change accounts automatically',
    },
  ]

  const rawOverall = clamp(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const overall = evidenceComplete ? rawOverall : Math.min(rawOverall, 79)
  const level = overall >= 80 ? 'advanced' : overall >= 55 ? 'adaptive' : 'basic'
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0]
  const nextMilestone = !evidenceComplete
    ? 'Run a frozen test set, capture runtime measurements, and backtest forecasts against the production gates.'
    : weakest.key === 'bank'
      ? 'Validate an active bank-consent path with a fresh, idempotent transaction sync.'
      : weakest.key === 'data'
        ? 'Record more confirmed, differently categorized transactions.'
        : weakest.key === 'prediction'
          ? 'Collect at least six months of transaction history.'
          : weakest.key === 'personalization'
            ? 'Confirm or correct more suggestions.'
            : weakest.key === 'models'
              ? 'Measure model load times, memory usage, and error rates on target devices.'
              : 'Validate quality metrics against real usage scenarios.'

  return { overall, level, dimensions, nextMilestone, evidenceComplete }
}
