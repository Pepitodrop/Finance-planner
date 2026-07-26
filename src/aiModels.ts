export type AiModelKey = 'semantic-multilingual' | 'semantic-fast' | 'zero-shot' | 'reasoning' | 'receipt'
export type AiPipelineTask = 'feature-extraction' | 'zero-shot-classification' | 'text-generation' | 'image-to-text'

export interface AiModelDefinition {
  key: AiModelKey
  model: string
  task: AiPipelineTask
  purpose: string
  enabledByDefault: boolean
  runtime: 'browser' | 'server-or-browser'
  loadPolicy: 'startup' | 'on-demand'
  dtype: 'q8' | 'q4' | 'fp16'
}

/**
 * Free Hugging Face models used by the intelligence layer.
 * Only the compact multilingual embedding model is loaded automatically.
 * Larger specialist models are lazy-loaded when their capability is requested.
 */
export const AI_MODELS: Record<AiModelKey, AiModelDefinition> = {
  'semantic-multilingual': {
    key: 'semantic-multilingual',
    model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    task: 'feature-extraction',
    purpose: 'Multilingual transaction categorisation and semantic similarity.',
    enabledByDefault: true,
    runtime: 'browser',
    loadPolicy: 'startup',
    dtype: 'q8',
  },
  'semantic-fast': {
    key: 'semantic-fast',
    model: 'Xenova/all-MiniLM-L6-v2',
    task: 'feature-extraction',
    purpose: 'Fast English similarity, duplicate detection, and merchant matching.',
    enabledByDefault: false,
    runtime: 'browser',
    loadPolicy: 'on-demand',
    dtype: 'q8',
  },
  'zero-shot': {
    key: 'zero-shot',
    model: 'MoritzLaurer/mDeBERTa-v3-base-mnli-xnli',
    task: 'zero-shot-classification',
    purpose: 'Multilingual zero-shot classification for new or custom categories.',
    enabledByDefault: false,
    runtime: 'server-or-browser',
    loadPolicy: 'on-demand',
    dtype: 'q8',
  },
  reasoning: {
    key: 'reasoning',
    model: 'onnx-community/Qwen2.5-0.5B-Instruct',
    task: 'text-generation',
    purpose: 'Local explanations, budget summaries, and financial coaching text.',
    enabledByDefault: false,
    runtime: 'browser',
    loadPolicy: 'on-demand',
    dtype: 'q4',
  },
  receipt: {
    key: 'receipt',
    model: 'Xenova/donut-base-finetuned-cord-v2',
    task: 'image-to-text',
    purpose: 'On-device receipt and invoice field extraction.',
    enabledByDefault: false,
    runtime: 'browser',
    loadPolicy: 'on-demand',
    dtype: 'fp16',
  },
}

export type LocalPipeline = (input: unknown, options?: Record<string, unknown>) => Promise<unknown>
type PipelineFactory = (task: string, model: string, options?: Record<string, unknown>) => Promise<LocalPipeline>

const pipelines = new Map<AiModelKey, Promise<LocalPipeline>>()

export function getAiModelCatalog(): AiModelDefinition[] {
  return Object.values(AI_MODELS)
}

export async function loadAiModel(key: AiModelKey): Promise<LocalPipeline> {
  const existing = pipelines.get(key)
  if (existing) return existing

  const definition = AI_MODELS[key]
  const promise = (async () => {
    const moduleUrl = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2'
    const transformers = await import(/* @vite-ignore */ moduleUrl) as { pipeline: PipelineFactory }
    return transformers.pipeline(definition.task, definition.model, { dtype: definition.dtype })
  })()

  pipelines.set(key, promise)
  try {
    return await promise
  } catch (error) {
    pipelines.delete(key)
    throw error
  }
}

export function clearAiModelCache(): void {
  pipelines.clear()
}
