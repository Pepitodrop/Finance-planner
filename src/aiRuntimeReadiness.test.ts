import { describe, expect, it } from 'vitest'
import { AI_MODELS, type AiModelDefinition } from './aiModels'
import { assessAiRuntimeReadiness } from './aiRuntimeReadiness'

describe('AI runtime readiness', () => {
  it('keeps the verified Hugging Face catalog lazy and runtime-separated', () => {
    const readiness = assessAiRuntimeReadiness()
    expect(readiness.startupModels).toBe(1)
    expect(readiness.onDemandModels).toBeGreaterThan(readiness.startupModels)
    expect(readiness.serverModels).toBeGreaterThanOrEqual(1)
    expect(readiness.warnings).toEqual([])
    expect(readiness.score).toBeGreaterThanOrEqual(90)
  })

  it('penalizes unsafe startup loading and invalid runtime metadata', () => {
    const broken: AiModelDefinition[] = [
      { ...AI_MODELS.reasoning, loadPolicy: 'startup' },
      { ...AI_MODELS.forecasting, runtime: 'browser' },
    ]
    const readiness = assessAiRuntimeReadiness(broken)
    expect(readiness.warnings.length).toBeGreaterThan(0)
    expect(readiness.score).toBeLessThan(90)
  })
})
