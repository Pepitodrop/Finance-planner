import { RECEIPT_MODEL } from './receipt-intelligence.js'

const DEFAULT_FINANCIAL_MODEL = 'Qwen/Qwen3-4B-Thinking-2507:fastest'
const DEFAULT_FINANCIAL_REVISION = '768f209d9ea81521153ed38c47d515654e938aea'

function validRevision(value) {
  return /^[0-9a-f]{40}$/.test(String(value || ''))
}

function validTimeout(value, fallback, min, max) {
  const parsed = Number(value || fallback)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
}

export function hostedAiCapabilities(env = process.env) {
  const tokenConfigured = Boolean(String(env.HF_TOKEN || '').trim())
  const financialModel = String(env.HF_MODEL || DEFAULT_FINANCIAL_MODEL)
  const financialRevision = String(env.HF_MODEL_REVISION || DEFAULT_FINANCIAL_REVISION)
  const financialConfigurationValid = Boolean(financialModel) && validRevision(financialRevision)
    && validTimeout(env.HF_TIMEOUT_MS, 30_000, 1_000, 90_000)
  const receiptModel = String(env.HF_RECEIPT_MODEL || RECEIPT_MODEL.model)
  const receiptConfigurationValid = receiptModel === RECEIPT_MODEL.model
    && validTimeout(env.HF_RECEIPT_TIMEOUT_MS || env.HF_TIMEOUT_MS, 45_000, 5_000, 90_000)

  const financial = {
    configured: tokenConfigured && financialConfigurationValid,
    ready: tokenConfigured && financialConfigurationValid,
    model: financialModel,
    revision: financialRevision,
    structuredOutput: true,
    externalData: 'aggregated-financial-snapshot-only',
    reason: !tokenConfigured ? 'missing_hf_token' : !financialConfigurationValid ? 'invalid_financial_model_configuration' : undefined,
  }
  const receipt = {
    configured: tokenConfigured && receiptConfigurationValid,
    ready: tokenConfigured && receiptConfigurationValid,
    model: receiptModel,
    license: RECEIPT_MODEL.license,
    multimodal: true,
    imageStored: false,
    reason: !tokenConfigured ? 'missing_hf_token' : !receiptConfigurationValid ? 'invalid_receipt_model_configuration' : undefined,
  }

  return {
    provider: 'hugging-face-inference-providers',
    tokenConfigured,
    ready: financial.ready && receipt.ready,
    financial,
    receipt,
    liveVerification: env.HF_LIVE_VERIFIED_AT
      ? { verified: true, verifiedAt: env.HF_LIVE_VERIFIED_AT }
      : { verified: false, reason: 'live_acceptance_not_recorded' },
  }
}
