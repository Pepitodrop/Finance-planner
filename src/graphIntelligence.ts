import { loadAiModel } from './aiModels'
import type { BehaviorEdge } from './behavior'

interface EmbeddingOutput { data: Float32Array | number[] }

export interface GraphMatch {
  edge: BehaviorEdge
  semanticScore: number
  behaviorScore: number
  combinedScore: number
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  const length = Math.min(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index]
    normA += a[index] ** 2
    normB += b[index] ** 2
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}

export function behaviorBanditScore(edge: BehaviorEdge): number {
  const evidence = 1 - Math.exp(-edge.confirmations / 4)
  const recencyDays = Math.max(0, (Date.now() - new Date(edge.lastUpdated).getTime()) / 86_400_000)
  const recency = Math.exp(-recencyDays / 180)
  return Math.max(0, Math.min(1, edge.weight * 0.6 + evidence * 0.25 + recency * 0.15))
}

/**
 * Retrieves semantically related behavior-graph edges with the free multilingual
 * E5 model. Raw descriptions and graph edges remain in browser memory.
 */
export async function retrieveBehaviorGraph(query: string, edges: BehaviorEdge[], limit = 5): Promise<GraphMatch[]> {
  if (!query.trim() || !edges.length) return []
  const extractor = await loadAiModel('graph-rag')
  const embed = async (text: string): Promise<number[]> => {
    const output = await extractor(text, { pooling: 'mean', normalize: true }) as EmbeddingOutput
    return Array.from(output.data)
  }

  const queryVector = await embed(`query: ${query}`)
  const matches = await Promise.all(edges.map(async (edge) => {
    const vector = await embed(`passage: merchant ${edge.merchant}; category ${edge.category}`)
    const semanticScore = Math.max(0, cosine(queryVector, vector))
    const behaviorScore = behaviorBanditScore(edge)
    return {
      edge,
      semanticScore,
      behaviorScore,
      combinedScore: semanticScore * 0.65 + behaviorScore * 0.35,
    }
  }))

  return matches.sort((a, b) => b.combinedScore - a.combinedScore).slice(0, Math.max(1, limit))
}
