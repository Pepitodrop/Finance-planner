import type { Transaction } from './types'

const STORAGE_KEY = 'finance-planner-behavior-graph-v1'

export interface BehaviorEdge {
  merchant: string
  category: string
  weight: number
  confirmations: number
  recurringVotes: number
  lastUpdated: string
}

export interface BehaviorPrediction {
  category?: string
  recurringProbability: number
  confidence: number
  evidence: string
}

function merchantKey(value: string): string {
  return value.toLocaleLowerCase('de-DE').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function loadBehaviorGraph(): BehaviorEdge[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as BehaviorEdge[]
  } catch {
    return []
  }
}

function saveBehaviorGraph(edges: BehaviorEdge[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edges))
}

export function learnBehavior(transaction: Transaction, category: string, recurring: boolean): void {
  const merchant = merchantKey(transaction.description)
  if (!merchant) return

  const edges = loadBehaviorGraph()
  const existing = edges.find((edge) => edge.merchant === merchant && edge.category === category)
  if (existing) {
    existing.confirmations += 1
    existing.weight = Math.min(1, existing.weight + 0.12)
    existing.recurringVotes += recurring ? 1 : 0
    existing.lastUpdated = new Date().toISOString()
  } else {
    edges.push({
      merchant,
      category,
      weight: 0.62,
      confirmations: 1,
      recurringVotes: recurring ? 1 : 0,
      lastUpdated: new Date().toISOString(),
    })
  }

  saveBehaviorGraph(edges.sort((a, b) => b.weight - a.weight).slice(0, 500))
}

export function predictFromBehavior(description: string): BehaviorPrediction | null {
  const merchant = merchantKey(description)
  const candidates = loadBehaviorGraph().filter((edge) => edge.merchant === merchant)
  if (!candidates.length) return null

  const best = candidates.sort((a, b) => b.weight - a.weight)[0]
  const recurringProbability = best.confirmations
    ? Math.round((best.recurringVotes / best.confirmations) * 100)
    : 0

  return {
    category: best.category,
    recurringProbability,
    confidence: Math.round(best.weight * 100),
    evidence: `${best.confirmations} bestätigte Entscheidung${best.confirmations === 1 ? '' : 'en'} für diesen Händler`,
  }
}

export function behaviorSummary(): { nodes: number; edges: number; learnedDecisions: number } {
  const edges = loadBehaviorGraph()
  return {
    nodes: new Set(edges.flatMap((edge) => [edge.merchant, edge.category])).size,
    edges: edges.length,
    learnedDecisions: edges.reduce((sum, edge) => sum + edge.confirmations, 0),
  }
}