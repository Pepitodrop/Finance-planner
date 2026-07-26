import { describe, expect, it } from 'vitest'
import { AI_MODELS, getAiModelCatalog } from './aiModels'

describe('Hugging Face model ensemble', () => {
  it('contains distinct specialist models for seven capabilities', () => {
    const catalog = getAiModelCatalog()
    expect(catalog).toHaveLength(7)
    expect(new Set(catalog.map((entry) => entry.model)).size).toBe(7)
    expect(new Set(catalog.map((entry) => entry.task))).toEqual(new Set([
      'feature-extraction',
      'zero-shot-classification',
      'text-generation',
      'image-to-text',
      'time-series-forecasting',
    ]))
  })

  it('loads only the compact multilingual model by default', () => {
    const defaults = getAiModelCatalog().filter((entry) => entry.enabledByDefault)
    expect(defaults.map((entry) => entry.key)).toEqual(['semantic-multilingual'])
    expect(defaults[0].loadPolicy).toBe('startup')
  })

  it('keeps heavy specialist models on demand', () => {
    expect(AI_MODELS['graph-rag'].loadPolicy).toBe('on-demand')
    expect(AI_MODELS['zero-shot'].loadPolicy).toBe('on-demand')
    expect(AI_MODELS.reasoning.loadPolicy).toBe('on-demand')
    expect(AI_MODELS.receipt.loadPolicy).toBe('on-demand')
    expect(AI_MODELS.forecasting.loadPolicy).toBe('on-demand')
  })

  it('separates browser models from the optional Python forecasting service', () => {
    expect(AI_MODELS['graph-rag'].loader).toBe('transformers-js')
    expect(AI_MODELS.forecasting.loader).toBe('python')
    expect(AI_MODELS.forecasting.runtime).toBe('server')
  })
})
