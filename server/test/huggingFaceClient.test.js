import assert from 'node:assert/strict'
import test from 'node:test'
import { createHuggingFaceChatTransport } from '../src/huggingFaceClient.js'

const revision = '768f209d9ea81521153ed38c47d515654e938aea'

test('requires a server-side token', () => {
  assert.throws(() => createHuggingFaceChatTransport(), /HF_TOKEN/)
})

test('requires an immutable model revision', async () => {
  const transport = createHuggingFaceChatTransport({ token: 'server-secret', fetchImpl: async () => { throw new Error('must not call') } })
  await assert.rejects(() => transport.chatCompletion({ model: 'model', messages: [] }), /immutable Hugging Face model revision/)
})

test('calls the Hugging Face OpenAI-compatible router with structured output and pinned revision', async () => {
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
    revision,
    messages: [{ role: 'user', content: 'analyse' }],
  })

  assert.match(request.url, /router\.huggingface\.co\/v1\/chat\/completions$/)
  assert.equal(request.init.headers.authorization, 'Bearer server-secret')
  assert.equal(request.init.headers['x-hf-model-revision'], revision)
  const body = JSON.parse(request.init.body)
  assert.equal(body.response_format.type, 'json_schema')
  assert.equal(body.response_format.json_schema.strict, true)
  assert.deepEqual(body.response_format.json_schema.schema.required, ['summary', 'confidence', 'signals'])
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false)
  assert.equal(body.temperature, 0.1)
  assert.equal(body.revision, revision)
  assert.equal(content, '{"summary":"ok","signals":[],"confidence":0.8}')
})

test('does not expose tokens in upstream error messages', async () => {
  const transport = createHuggingFaceChatTransport({
    token: 'server-secret',
    fetchImpl: async () => new Response('rate limited', { status: 429 }),
  })
  await assert.rejects(
    () => transport.chatCompletion({ model: 'model', revision, messages: [] }),
    (error) => error.message.includes('429') && !error.message.includes('server-secret'),
  )
})
