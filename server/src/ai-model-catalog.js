export const AI_MODEL_CATALOG = Object.freeze([
  {
    id: 'Qwen/Qwen3-4B-Thinking-2507:fastest',
    capability: 'financial-reasoning',
    execution: 'hosted-or-self-hosted',
    integrationStatus: 'integrated',
    enabledByDefault: true,
    license: 'Apache-2.0',
    purpose: 'Primary governed analyst for guarded financial reasoning over aggregated snapshots.',
  },
  {
    id: 'Qwen/Qwen3-4B-Instruct-2507:fastest',
    capability: 'independent-critique',
    execution: 'hosted-or-self-hosted',
    integrationStatus: 'integrated-optional',
    enabledByDefault: false,
    license: 'Apache-2.0',
    purpose: 'Optional second-pass critic that removes unsupported claims and calibrates confidence.',
  },
  {
    id: 'Qwen/Qwen2.5-VL-7B-Instruct:fastest',
    capability: 'sustainable-receipt-review',
    execution: 'hosted-or-self-hosted',
    integrationStatus: 'integrated',
    enabledByDefault: true,
    license: 'Apache-2.0',
    purpose: 'Provider-routed vision-language model for one-time grocery receipt extraction and estimated BIO, Fairtrade, environmental and affordability guidance.',
  },
  {
    id: 'BAAI/bge-m3',
    capability: 'multilingual-retrieval',
    execution: 'local-optional',
    integrationStatus: 'worker-ready',
    enabledByDefault: false,
    license: 'MIT',
    purpose: 'Open multilingual embeddings for semantic finance-history retrieval and clustering.',
  },
  {
    id: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    capability: 'lightweight-semantic-search',
    execution: 'local-optional',
    integrationStatus: 'worker-ready',
    enabledByDefault: false,
    license: 'Apache-2.0',
    purpose: 'Small multilingual embedding model for low-resource semantic matching.',
  },
  {
    id: 'openai/whisper-tiny',
    capability: 'voice-entry',
    execution: 'local-optional',
    integrationStatus: 'worker-ready',
    enabledByDefault: false,
    license: 'MIT',
    purpose: 'Open speech recognition model for short German or English finance-entry transcription.',
  },
  {
    id: 'microsoft/Florence-2-base',
    capability: 'receipt-extraction',
    execution: 'local-optional',
    integrationStatus: 'worker-ready',
    enabledByDefault: false,
    license: 'MIT',
    purpose: 'Open vision-language model for future fully local receipt and invoice extraction in a sandboxed worker.',
  },
])

export function publicModelCatalog() {
  return AI_MODEL_CATALOG.map((model) => ({ ...model }))
}
