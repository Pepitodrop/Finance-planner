export const AI_MODEL_CATALOG = Object.freeze([
  {
    id: 'Qwen/Qwen3-4B-Thinking-2507:fastest',
    capability: 'financial-reasoning',
    execution: 'hosted-optional',
    integrationStatus: 'integrated',
    enabledByDefault: true,
    purpose: 'Generates guarded explanations from aggregated financial snapshots.',
  },
  {
    id: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    capability: 'semantic-search',
    execution: 'local-optional',
    integrationStatus: 'catalog-only',
    enabledByDefault: false,
    purpose: 'Candidate model for multilingual transaction and finance-history similarity.',
  },
  {
    id: 'openai/whisper-tiny',
    capability: 'voice-entry',
    execution: 'local-optional',
    integrationStatus: 'catalog-only',
    enabledByDefault: false,
    purpose: 'Candidate model for short German or English voice-entry transcription.',
  },
  {
    id: 'microsoft/Florence-2-base',
    capability: 'receipt-extraction',
    execution: 'local-optional',
    integrationStatus: 'catalog-only',
    enabledByDefault: false,
    purpose: 'Candidate model for receipt and invoice extraction.',
  },
  {
    id: 'mgalkin/ultra_3g',
    capability: 'relationship-prediction',
    execution: 'local-experimental',
    integrationStatus: 'catalog-only',
    enabledByDefault: false,
    purpose: 'Experimental candidate for typed knowledge-graph link prediction.',
  },
])

export function publicModelCatalog() {
  return AI_MODEL_CATALOG.map((model) => ({ ...model }))
}
