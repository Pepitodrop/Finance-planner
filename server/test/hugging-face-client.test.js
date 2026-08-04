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
})

test('hosted inference does not retry a rejected client request', async () => {
  let calls = 0
  const transport = createHuggingFaceChatTransport({
    token: 'hf-test-token',
    timeoutMs: 5_000,
    retries: 2,
    fetchImpl: async () => {
      calls += 1
      return new Response('bad request', { status: 400 })
    },
  })
  await assert.rejects(
    () => transport.chatCompletion({ model: 'Qwen/test:fastest', revision, messages }),
    /failed \(400\)/,
  )
  assert.equal(calls, 1)
})

test('hosted inference requires immutable revisions and bounded runtime settings', async () => {
  const transport = createHuggingFaceChatTransport({ token: 'hf-test-token', fetchImpl: async () => new Response('{}') })
  await assert.rejects(() => transport.chatCompletion({ model: 'model', revision: 'latest', messages }), /immutable/)
  assert.throws(() => createHuggingFaceChatTransport({ token: 'token', timeoutMs: 10 }), /timeout/)
  assert.throws(() => createHuggingFaceChatTransport({ token: 'token', retries: 10 }), /retry/)
})
