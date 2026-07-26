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

  if (startupModels > 1) warnings.push('Mehr als ein Modell wird beim Start geladen; das erhöht Ladezeit und Speicherbedarf.')
  if (models.some((model) => model.loader === 'python' && model.runtime !== 'server')) warnings.push('Python-Modelle müssen als Server-Workload markiert sein.')
  if (models.some((model) => model.loader === 'transformers-js' && model.runtime === 'server')) warnings.push('Transformers.js-Modelle sollten nicht unnötig auf den Server beschränkt sein.')
  if (models.some((model) => !model.license.trim())) warnings.push('Für jedes Modell muss eine Lizenz dokumentiert sein.')
  if (models.some((model) => !model.model.includes('/'))) warnings.push('Modell-IDs müssen als Hugging-Face-Repository angegeben sein.')

  const architectureScore = 45
    + Math.min(25, onDemandModels * 4)
    + (startupModels === 1 ? 15 : 0)
    + (serverModels >= 1 ? 8 : 0)
    + (models.every((model) => Boolean(model.license.trim())) ? 7 : 0)

  const score = clamp(architectureScore - warnings.length * 12)
  const evidence = `${models.length} Hugging-Face-Modelle: ${browserModels} browserfähig, ${serverModels} serverseitig, ${onDemandModels} bedarfsgesteuert.`

  return { score, browserModels, serverModels, startupModels, onDemandModels, warnings, evidence }
}
