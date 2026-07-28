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
    async chatCompletion({ model, messages, temperature = 0.1, maxTokens = 900, signal }) {
      const controller = new AbortController()
      const unlink = linkAbortSignals(controller, signal)
      const timeout = setTimeout(() => controller.abort(new Error('Hugging Face inference timed out')), timeoutMs)
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            response_format: { type: 'json_object' },
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
