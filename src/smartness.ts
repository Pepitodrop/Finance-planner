import type { AppState } from './types'

export interface SmartnessDimension {
  key: 'data' | 'personalization' | 'prediction' | 'explainability' | 'safety'
  label: string
  score: number
  evidence: string
}

export interface SmartnessAssessment {
  overall: number
  level: 'basic' | 'adaptive' | 'advanced'
  dimensions: SmartnessDimension[]
  nextMilestone: string
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function assessSmartness(state: AppState, learnedDecisions: number): SmartnessAssessment {
  const transactions = state.transactions.length
  const categories = new Set(state.transactions.map((item) => item.category).filter(Boolean)).size
  const recurring = state.transactions.filter((item) => item.recurring).length
  const months = new Set(state.transactions.map((item) => item.date.slice(0, 7))).size
  const goals = state.goals.length

  const dimensions: SmartnessDimension[] = [
    {
      key: 'data',
      label: 'Datengrundlage',
      score: clamp(transactions * 1.2 + categories * 4 + months * 5),
      evidence: `${transactions} Buchungen, ${categories} Kategorien und ${months} Monate Historie`,
    },
    {
      key: 'personalization',
      label: 'Personalisierung',
      score: clamp(20 + learnedDecisions * 3 + recurring * 2),
      evidence: `${learnedDecisions} bestätigte Lernentscheidungen und ${recurring} wiederkehrende Buchungen`,
    },
    {
      key: 'prediction',
      label: 'Prognosefähigkeit',
      score: clamp(15 + months * 9 + Math.min(transactions, 60) * .5),
      evidence: months >= 6 ? 'Mehrmonatige Muster sind auswertbar' : 'Für stabile Prognosen fehlen noch mehrere Monate Historie',
    },
    {
      key: 'explainability',
      label: 'Erklärbarkeit',
      score: 82,
      evidence: 'Regeln, Modellquelle, Unsicherheit und Alternativen werden getrennt ausgewiesen',
    },
    {
      key: 'safety',
      label: 'Sicherheit',
      score: goals > 0 ? 88 : 84,
      evidence: 'Finanzaktionen bleiben genehmigungspflichtig und verändern keine Konten automatisch',
    },
  ]

  const overall = clamp(dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length)
  const level = overall >= 80 ? 'advanced' : overall >= 55 ? 'adaptive' : 'basic'
  const weakest = [...dimensions].sort((a, b) => a.score - b.score)[0]
  const nextMilestone = weakest.key === 'data'
    ? 'Mehr bestätigte, unterschiedlich kategorisierte Buchungen erfassen.'
    : weakest.key === 'prediction'
      ? 'Mindestens sechs Monate Transaktionshistorie sammeln.'
      : weakest.key === 'personalization'
        ? 'Weitere KI-Vorschläge bestätigen oder korrigieren.'
        : 'Qualitätsmetriken mit realen Nutzungsszenarien validieren.'

  return { overall, level, dimensions, nextMilestone }
}
