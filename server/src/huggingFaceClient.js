const DEFAULT_BASE_URL = 'https://router.huggingface.co/v1'
const MAX_RETRY_DELAY_MS = 5_000
const MAX_MESSAGE_COUNT = 12
const MAX_MESSAGE_BYTES = 32_768
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant'])
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/

function linkAbortSignals(controller, signal) {
  if (!signal) return () => {}
  if (signal.aborted) {
    controller.abort(signal.reason)
    return () => {}
  }
  const onAbort = () => controller.abort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

function retryAfterMs(value, attempt) {
  if (value) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
    const date = Date.parse(value)
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_DELAY_MS)
  }
  return Math.min(400 * (2 ** attempt), MAX_RETRY_DELAY_MS)
}

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason || new Error('Hugging Face inference aborted'))
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason || new Error('Hugging Face inference aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function validateBaseUrl(value) {
  const parsed = new URL(String(value || ''))
  if (parsed.protocol !== 'https:' || parsed.origin !== 'https://router.huggingface.co' || parsed.pathname.replace(/\/$/, '') !== '/v1') {
    throw new Error('Hugging Face base URL must use the reviewed provider endpoint')
  }
  return parsed.toString().replace(/\/$/, '')
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGE_COUNT) {
    throw new Error('Hugging Face messages must be a bounded non-empty array')
  }
  let totalBytes = 0
  const normalized = messages.map((message) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Hugging Face message is invalid')
    if (Object.keys(message).some((key) => !['role', 'content'].includes(key))) throw new Error('Hugging Face message contains an unexpected field')
    if (!ALLOWED_ROLES.has(message.role) || typeof message.content !== 'string') {
      throw new Error('Financial hosted inference accepts text-only system, user, and assistant messages')
    }
    if (!message.content.trim() || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(message.content)) {
      throw new Error('Hugging Face message content is invalid')
    }
    totalBytes += Buffer.byteLength(message.content, 'utf8')
    return { role: message.role, content: message.content }
  })
  if (totalBytes > MAX_MESSAGE_BYTES) throw new Error('Hugging Face message content exceeds the production limit')
  return normalized
}

export function createHuggingFaceChatTransport({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 15000,
  retries = 2,
} = {}) {
  if (!token) throw new Error('HF_TOKEN is required for Hugging Face inference')
  const reviewedBaseUrl = validateBaseUrl(baseUrl)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 90_000) throw new Error('Hugging Face timeout is invalid')
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) throw new Error('Hugging Face retry count is invalid')

  return {
    async chatCompletion({ model, revision, messages, temperature = 0.1, maxTokens = 900, signal }) {
      if (!MODEL_ID.test(String(model || ''))) throw new Error('Hugging Face model identifier is invalid')
      if (!revision || !/^[0-9a-f]{40}$/.test(revision)) throw new Error('An immutable Hugging Face model revision is required')
      if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new Error('Hugging Face temperature is invalid')
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 4096) throw new Error('Hugging Face token limit is invalid')
      const safeMessages = validateMessages(messages)
      const controller = new AbortController()
      const unlink = linkAbortSignals(controller, signal)
      const timeout = setTimeout(() => controller.abort(new Error('Hugging Face inference timed out')), timeoutMs)
      try {
        for (let attempt = 0; attempt <= retries; attempt += 1) {
          let response
          try {
            response = await fetchImpl(`${reviewedBaseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                'x-hf-model-revision': revision,
              },
              body: JSON.stringify({
                model,
                revision,
                messages: safeMessages,
                temperature,
                max_tokens: maxTokens,
                response_format: {
                  type: 'json_schema',
                  json_schema: {
                    name: 'financial_intelligence',
                    strict: true,
                    schema: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['summary', 'confidence', 'signals'],
                      properties: {
                        summary: { type: 'string', minLength: 1, maxLength: 800 },
                        confidence: { type: 'number', minimum: 0, maximum: 1 },
                        signals: {
                          type: 'array',
                          maxItems: 8,
                          items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['type', 'severity', 'title', 'explanation', 'confidence', 'evidence', 'suggestedAction', 'requiresApproval'],
                            properties: {
                              type: { type: 'string', enum: ['cashflow', 'recurring-cost', 'goal-risk', 'anomaly', 'data-quality'] },
                              severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
                              title: { type: 'string', minLength: 1, maxLength: 140 },
                              explanation: { type: 'string', minLength: 1, maxLength: 600 },
                              confidence: { type: 'number', minimum: 0, maximum: 1 },
                              evidence: { type: 'array', maxItems: 5, items: { type: 'string', maxLength: 200 } },
                              suggestedAction: { type: 'string', maxLength: 300 },
                              requiresApproval: { type: 'boolean' },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              }),
              signal: controller.signal,
            })
          } catch (error) {
            if (controller.signal.aborted || attempt === retries) throw error
            await sleep(retryAfterMs(null, attempt), controller.signal)
            continue
          }

          if (!response.ok) {
            const retryable = response.status === 429 || response.status >= 500
            if (retryable && attempt < retries) {
              await sleep(retryAfterMs(response.headers.get('retry-after'), attempt), controller.signal)
              continue
            }
            throw new Error(`Hugging Face inference failed (${response.status})`)
          }

          const payload = await response.json()
          const content = payload?.choices?.[0]?.message?.content
          if (typeof content !== 'string' || !content.trim()) throw new Error('Hugging Face returned no assistant content')
          return content
        }
        throw new Error('Hugging Face inference failed after retries')
      } finally {
        clearTimeout(timeout)
        unlink()
      }
    },
  }
}
