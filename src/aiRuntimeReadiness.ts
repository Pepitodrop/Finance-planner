import { getAiModelCatalog, type AiModelDefinition } from './aiModels'

export interface AiRuntimeReadiness {
  score: number
  browserModels: number
  serverModels: number
  startupModels: number
  onDemandModels: number
  warnings: string[]
  evidence: string
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export function assessAiRuntimeReadiness(models: AiModelDefinition[] = getAiModelCatalog()): AiRuntimeReadiness {
  const browserModels = models.filter((model) => model.runtime === 'browser' || model.runtime === 'server-or-browser').length
  const serverModels = models.filter((model) => model.runtime === 'server').length
  const startupModels = models.filter((model) => model.loadPolicy === 'startup').length
  const onDemandModels = models.filter((model) => model.loadPolicy === 'on-demand').length
  const warnings: string[] = []

  if (startupModels > 1) warnings.push('More than one model loads at startup; this increases load time and memory use.')
  if (models.some((model) => model.loader === 'python' && model.runtime !== 'server')) warnings.push('Python models must be marked as a server workload.')
  if (models.some((model) => model.loader === 'transformers-js' && model.runtime === 'server')) warnings.push('Transformers.js models should not be unnecessarily restricted to the server.')
  if (models.some((model) => !model.license.trim())) warnings.push('Every model must have a documented license.')
  if (models.some((model) => !model.model.includes('/'))) warnings.push('Model IDs must be given as a Hugging Face repository.')

  const architectureScore = 45
    + Math.min(25, onDemandModels * 4)
    + (startupModels === 1 ? 15 : 0)
    + (serverModels >= 1 ? 8 : 0)
    + (models.every((model) => Boolean(model.license.trim())) ? 7 : 0)

  const score = clamp(architectureScore - warnings.length * 12)
  const evidence = `${models.length} Hugging Face models: ${browserModels} browser-capable, ${serverModels} server-side, ${onDemandModels} on-demand.`

  return { score, browserModels, serverModels, startupModels, onDemandModels, warnings, evidence }
}
