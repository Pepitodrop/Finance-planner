const DEFAULT_BASE_URL = 'https://router.huggingface.co/v1'

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

export function createHuggingFaceChatTransport({
  token,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  timeoutMs = 15000,
} = {}) {
  if (!token) throw new Error('HF_TOKEN is required for Hugging Face inference')

  return {
    async chatCompletion({ model, revision, messages, temperature = 0.1, maxTokens = 900, signal }) {
      if (!revision || !/^[0-9a-f]{40}$/.test(revision)) throw new Error('An immutable Hugging Face model revision is required')
      const controller = new AbortController()
      const unlink = linkAbortSignals(controller, signal)
      const timeout = setTimeout(() => controller.abort(new Error('Hugging Face inference timed out')), timeoutMs)
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            'x-hf-model-revision': revision,
          },
          body: JSON.stringify({
            model,
            revision,
            messages,
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
                    summary: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 800
                    },
                    confidence: {
                      type: 'number',
                      minimum: 0,
                      maximum: 1
                    },
                    signals: {
                      type: 'array',
                      maxItems: 8,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                          'type',
                          'severity',
                          'title',
                          'explanation',
                          'confidence',
                          'evidence',
                          'suggestedAction',
                          'requiresApproval'
                        ],
                        properties: {
                          type: {
                            type: 'string',
                            enum: [
                              'cashflow',
                              'recurring-cost',
                              'goal-risk',
                              'anomaly',
                              'data-quality'
                            ]
                          },
                          severity: {
                            type: 'string',
                            enum: ['info', 'warning', 'critical']
                          },
                          title: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 140
                          },
                          explanation: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 600
                          },
                          confidence: {
                            type: 'number',
                            minimum: 0,
                            maximum: 1
                          },
                          evidence: {
                            type: 'array',
                            maxItems: 5,
                            items: {
                              type: 'string',
                              maxLength: 200
                            }
                          },
                          suggestedAction: {
                            type: 'string',
                            maxLength: 300
                          },
                          requiresApproval: {
                            type: 'boolean'
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(`Hugging Face inference failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`)
        }

        const payload = await response.json()
        const content = payload?.choices?.[0]?.message?.content
        if (typeof content !== 'string' || !content.trim()) throw new Error('Hugging Face returned no assistant content')
        return content
      } finally {
        clearTimeout(timeout)
        unlink()
      }
    },
  }
}
