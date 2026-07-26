export type AiModelKey = 'semantic-multilingual' | 'semantic-fast' | 'graph-rag' | 'zero-shot' | 'reasoning' | 'receipt' | 'forecasting'
export type AiPipelineTask = 'feature-extraction' | 'zero-shot-classification' | 'text-generation' | 'image-to-text' | 'time-series-forecasting'

export interface AiModelDefinition {
  key: AiModelKey
  model: string
  task: AiPipelineTask
  purpose: string
  enabledByDefault: boolean
  runtime: 'browser' | 'server-or-browser' | 'server'
  loadPolicy: 'startup' | 'on-demand'
  dtype: 'q8' | 'q4' | 'fp16'
  loader: 'transformers-js' | 'python'
  license: string
}

/**
 * Free Hugging Face models used by the intelligence layer.
 * Only the compact multilingual categorisation model is loaded automatically.
 * Specialist and larger models are loaded only when their feature is requested.
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
    loader: 'transformers-js',
    license: 'Apache-2.0',
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
    loader: 'transformers-js',
    license: 'Apache-2.0',
  },
  'graph-rag': {
    key: 'graph-rag',
    model: 'Xenova/multilingual-e5-small',
    task: 'feature-extraction',
    purpose: 'Multilingual behavior-graph node embeddings and private financial-history retrieval.',
    enabledByDefault: false,
    runtime: 'browser',
    loadPolicy: 'on-demand',
    dtype: 'q8',
    loader: 'transformers-js',
    license: 'MIT',
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
    loader: 'transformers-js',
    license: 'MIT',
  },
  reasoning: {
    key: 'reasoning',
    model: 'onnx-community/Qwen2.5-0.5B-Instruct',
    task: 'text-generation',
    purpose: 'Local RAG answers, explanations, budget summaries, and approval-gated planning.',
    enabledByDefault: false,
    runtime: 'browser',
    loadPolicy: 'on-demand',
    dtype: 'q4',
    loader: 'transformers-js',
    license: 'Apache-2.0',
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
    loader: 'transformers-js',
    license: 'Apache-2.0',
  },
  forecasting: {
    key: 'forecasting',
    model: 'ibm-granite/granite-timeseries-ttm-r2',
    task: 'time-series-forecasting',
    purpose: 'Optional server-side cash-flow and spending time-series forecasts with uncertainty bands.',
    enabledByDefault: false,
    runtime: 'server',
    loadPolicy: 'on-demand',
    dtype: 'fp16',
    loader: 'python',
    license: 'Apache-2.0',
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
  if (definition.loader !== 'transformers-js') {
    throw new Error(`${definition.model} requires the optional server-side Python inference service`)
  }

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
