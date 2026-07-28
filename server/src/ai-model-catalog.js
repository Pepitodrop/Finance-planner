export const AI_MODEL_CATALOG = Object.freeze([
  {
    id: 'Qwen/Qwen3-4B-Thinking-2507:fastest',
    capability: 'financial-reasoning',
    execution: 'hosted-optional',
    enabledByDefault: true,
    purpose: 'Generates guarded explanations from aggregated financial snapshots.',
  },
  {
    id: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    capability: 'semantic-search',
    execution: 'local-optional',
    enabledByDefault: false,
    purpose: 'Creates multilingual embeddings for transaction and finance-history similarity.',
  },
  {
    id: 'openai/whisper-tiny',
    capability: 'voice-entry',
    execution: 'local-optional',
    enabledByDefault: false,
    purpose: 'Transcribes short German or English voice entries into draft finance commands.',
  },
  {
    id: 'microsoft/Florence-2-base',
    capability: 'receipt-extraction',
    execution: 'local-optional',
    enabledByDefault: false,
    purpose: 'Extracts draft receipt and invoice information from images for user confirmation.',
  },
  {
    id: 'mgalkin/ultra_3g',
    capability: 'relationship-prediction',
    execution: 'local-experimental',
    enabledByDefault: false,
    purpose: 'Experimental knowledge-graph link prediction for learned financial relationships.',
  },
])

export function publicModelCatalog() {
  return AI_MODEL_CATALOG.map((model) => ({ ...model }))
}
