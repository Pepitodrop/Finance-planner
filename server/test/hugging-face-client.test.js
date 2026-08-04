import assert from 'node:assert/strict'
import test from 'node:test'
import { createHuggingFaceChatTransport } from '../src/huggingFaceClient.js'

const revision = 'a'.repeat(40)
const messages = [{ role: 'user', content: 'Analyze this aggregate snapshot.' }]

test('hosted inference retries transient provider failures and preserves structured output', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) return new Response('temporary', { status: 503, headers: { 'Retry-After': '0' } })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"summary":"ok","confidence":1,"signals":[]}' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const transport = createHuggingFaceChatTransport({ token: 'hf-test-token', fetchImpl, timeoutMs: 5_000, retries: 1 })
  const result = await transport.chatCompletion({ model: 'Qwen/test:fastest', revision, messages })

  assert.equal(result, '{"summary":"ok","confidence":1,"signals":[]}')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, 'https://router.huggingface.co/v1/chat/completions')
  assert.equal(calls[0].options.headers.authorization, 'Bearer hf-test-token')
  const request = JSON.parse(calls[1].options.body)
  assert.equal(request.response_format.type, 'json_schema')
  assert.equal(request.response_format.json_schema.strict, true)
  assert.equal(request.revision, revision)
  assert.deepEqual(request.messages, messages)
})

test('hosted inference does not retry a rejected client request or expose its body', async () => {
  let calls = 0
  const transport = createHuggingFaceChatTransport({
    token: 'hf-test-token',
    timeoutMs: 5_000,
    retries: 2,
    fetchImpl: async () => {
      calls += 1
      return new Response('provider-sensitive-detail', { status: 400 })
    },
  })
  await assert.rejects(
    () => transport.chatCompletion({ model: 'Qwen/test:fastest', revision, messages }),
    (error) => /failed \(400\)/.test(error.message) && !error.message.includes('provider-sensitive-detail'),
  )
  assert.equal(calls, 1)
})

test('hosted inference requires reviewed endpoint, model identifiers, immutable revisions and bounded runtime settings', async () => {
  const transport = createHuggingFaceChatTransport({ token: 'hf-test-token', fetchImpl: async () => new Response('{}') })
  await assert.rejects(() => transport.chatCompletion({ model: 'invalid model', revision, messages }), /model identifier/)
  await assert.rejects(() => transport.chatCompletion({ model: 'Qwen/test:fastest', revision: 'latest', messages }), /immutable/)
  assert.throws(() => createHuggingFaceChatTransport({ token: 'token', baseUrl: 'https://example.test/v1' }), /reviewed provider endpoint/)
  assert.throws(() => createHuggingFaceChatTransport({ token: 'token', timeoutMs: 10 }), /timeout/)
  assert.throws(() => createHuggingFaceChatTransport({ token: 'token', retries: 10 }), /retry/)
})

test('financial hosted inference rejects file-like, multimodal and oversized message payloads', async () => {
  let calls = 0
  const transport = createHuggingFaceChatTransport({
    token: 'hf-test-token',
    fetchImpl: async () => {
      calls += 1
      return new Response('{}')
    },
  })

  await assert.rejects(
    () => transport.chatCompletion({
      model: 'Qwen/test:fastest',
      revision,
      messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'file:///tmp/receipt.png' } }] }],
    }),
    /text-only/,
  )
  await assert.rejects(
    () => transport.chatCompletion({
      model: 'Qwen/test:fastest',
      revision,
      messages: [{ role: 'user', content: 'x'.repeat(32_769) }],
    }),
    /production limit/,
  )
  await assert.rejects(
    () => transport.chatCompletion({
      model: 'Qwen/test:fastest',
      revision,
      messages: [{ role: 'tool', content: 'file content' }],
    }),
    /text-only/,
  )
  assert.equal(calls, 0)
})
