import { mkdir, writeFile } from 'node:fs/promises'
import { hostedAiCapabilities } from '../server/src/ai-capabilities.js'

const endpoint = 'https://router.huggingface.co/v1/chat/completions'
const token = String(process.env.HF_TOKEN || '').trim()
const requireLive = process.env.REQUIRE_LIVE_AI_ACCEPTANCE === 'true'
const financialModel = process.env.HF_MODEL || 'Qwen/Qwen3-4B-Thinking-2507:fastest'
const financialRevision = process.env.HF_MODEL_REVISION || '768f209d9ea81521153ed38c47d515654e938aea'
const receiptModel = process.env.HF_RECEIPT_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct:fastest'
const artifactPath = 'artifacts/live-ai-acceptance.json'
const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbCQAAAAASUVORK5CYII='

const evidence = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  provider: 'hugging-face-inference-providers',
  configuration: hostedAiCapabilities(process.env),
  status: 'pending',
  financial: { model: financialModel, revision: financialRevision, status: 'pending' },
  receipt: { model: receiptModel, status: 'pending', syntheticImage: true },
}

async function persist() {
  await mkdir('artifacts', { recursive: true })
  await writeFile(artifactPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
}

async function inference(body, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Live hosted inference timed out')), timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Hugging Face returned ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`)
    let payload
    try { payload = JSON.parse(text) } catch { throw new Error('Hugging Face returned malformed response JSON') }
    const content = payload?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('Hugging Face returned no assistant content')
    let structured
    try { structured = JSON.parse(content) } catch { throw new Error('Hugging Face did not satisfy the requested JSON schema') }
    return { structured, durationMs: Date.now() - startedAt }
  } finally {
    clearTimeout(timer)
  }
}

try {
  if (!token) {
    evidence.status = 'blocked_by_credentials'
    evidence.financial.status = 'blocked_by_credentials'
    evidence.receipt.status = 'blocked_by_credentials'
    evidence.blocker = 'HF_TOKEN is not configured for this GitHub Actions environment.'
    await persist()
    if (requireLive) throw new Error(evidence.blocker)
    console.log('Hosted AI acceptance is blocked by credentials; evidence was recorded.')
    process.exit(0)
  }

  if (!evidence.configuration.ready) throw new Error('Hosted AI production configuration is not valid.')

  const financial = await inference({
    model: financialModel,
    revision: financialRevision,
    temperature: 0,
    max_tokens: 220,
    messages: [
      { role: 'system', content: 'Return only the requested JSON. Do not propose or execute financial transactions.' },
      { role: 'user', content: 'Analyze this synthetic aggregate snapshot: incomeCents=200000, expenseCents=150000, freeCashCents=50000. Return one concise data-quality signal.' },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'finance_planner_live_acceptance',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['summary', 'confidence', 'signals'],
          properties: {
            summary: { type: 'string', minLength: 1, maxLength: 300 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            signals: {
              type: 'array',
              minItems: 1,
              maxItems: 2,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['type', 'title'],
                properties: {
                  type: { type: 'string', enum: ['data-quality'] },
                  title: { type: 'string', minLength: 1, maxLength: 120 },
                },
              },
            },
          },
        },
      },
    },
  }, 60_000)
  if (!financial.structured.summary || !Array.isArray(financial.structured.signals)) throw new Error('Financial inference result failed acceptance validation')
  evidence.financial = { ...evidence.financial, status: 'verified', durationMs: financial.durationMs, structuredOutput: true }

  const receipt = await inference({
    model: receiptModel,
    temperature: 0,
    max_tokens: 120,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'This is a synthetic one-pixel image used only to verify the vision transport. Return false when it is not a readable receipt.' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${onePixelPng}` } },
      ],
    }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'receipt_vision_live_acceptance',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['readableReceipt', 'confidence'],
          properties: {
            readableReceipt: { type: 'boolean' },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  }, 90_000)
  if (typeof receipt.structured.readableReceipt !== 'boolean' || typeof receipt.structured.confidence !== 'number') {
    throw new Error('Receipt vision result failed acceptance validation')
  }
  evidence.receipt = { ...evidence.receipt, status: 'verified', durationMs: receipt.durationMs, structuredOutput: true, imageStored: false }
  evidence.status = 'verified'
  evidence.verifiedAt = new Date().toISOString()
  await persist()
  console.log('Hosted financial and receipt inference acceptance passed.')
} catch (error) {
  evidence.status = evidence.status === 'blocked_by_credentials' ? evidence.status : 'failed'
  evidence.error = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
  await persist()
  console.error(evidence.error)
  process.exit(1)
}
