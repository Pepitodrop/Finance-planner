import assert from 'node:assert/strict'
import test from 'node:test'
import { createHuggingFaceChatTransport } from '../src/huggingFaceClient.js'

test('requires a server-side token', () => {
  assert.throws(() => createHuggingFaceChatTransport(), /HF_TOKEN/)
})

test('calls the Hugging Face OpenAI-compatible router with structured output', async () => {
  let request
  const fetchImpl = async (url, init) => {
    request = { url, init }
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok","signals":[],"confidence":0.8}' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const transport = createHuggingFaceChatTransport({ token: 'server-secret', fetchImpl })
  const content = await transport.chatCompletion({
    model: 'Qwen/Qwen3-4B-Thinking-2507:fastest',
    messages: [{ role: 'user', content: 'analyse' }],
  })

  assert.match(request.url, /router\.huggingface\.co\/v1\/chat\/completions$/)
  assert.equal(request.init.headers.authorization, 'Bearer server-secret')
  const body = JSON.parse(request.init.body)
  assert.equal(body.response_format.type, 'json_object')
  assert.equal(body.temperature, 0.1)
  assert.equal(content, '{"summary":"ok","signals":[],"confidence":0.8}')
})

test('does not expose tokens in upstream error messages', async () => {
  const transport = createHuggingFaceChatTransport({
    token: 'server-secret',
    fetchImpl: async () => new Response('rate limited', { status: 429 }),
  })
  await assert.rejects(
    () => transport.chatCompletion({ model: 'model', messages: [] }),
    (error) => error.message.includes('429') && !error.message.includes('server-secret'),
  )
})
