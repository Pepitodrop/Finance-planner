import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import test from 'node:test'
import { bankProductionCapabilities, processWebhook, verifyWebhookRequest } from '../src/webhook-security.js'

const secret = 'a-production-grade-webhook-secret-with-32-chars'

function signedRequest(payload, { eventId = 'event-12345678', timestamp = '2026-07-28T19:00:00.000Z', signature } = {}) {
  const raw = Buffer.from(JSON.stringify(payload))
  const digest = signature || createHmac('sha256', secret).update(timestamp).update('.').update(raw).digest('hex')
  const request = Readable.from([raw])
  request.headers = {
    'content-type': 'application/json',
    'x-webhook-id': eventId,
    'x-webhook-timestamp': timestamp,
    'x-webhook-signature': `sha256=${digest}`,
  }
  return { request, raw }
}

test('verifies a signed webhook inside the replay window', () => {
  const { request, raw } = signedRequest({ type: 'transactions.updated' })
  const result = verifyWebhookRequest({ request, rawBody: raw, provider: 'gocardless', secret, now: Date.parse('2026-07-28T19:02:00.000Z') })
  assert.equal(result.eventId, 'event-12345678')
})

test('rejects an invalid signature', () => {
  const { request, raw } = signedRequest({ type: 'transactions.updated' }, { signature: '0'.repeat(64) })
  assert.throws(() => verifyWebhookRequest({ request, rawBody: raw, provider: 'gocardless', secret, now: Date.parse('2026-07-28T19:02:00.000Z') }), /signature/i)
})

test('claims, completes, and deduplicates webhook events', async () => {
  const completed = new Set()
  let active = null
  const store = {
    async claimWebhookEvent(input) {
      if (completed.has(input.eventId) || active) return undefined
      active = 'lease'
      return active
    },
    async getWebhookEventState(_provider, eventId) {
      if (completed.has(eventId)) return 'completed'
      return active ? 'processing' : 'missing'
    },
    async completeWebhookEvent(input) {
      assert.equal(input.leaseToken, active)
      completed.add(input.eventId)
      active = null
      return true
    },
    async releaseWebhookEvent() { active = null; return true },
  }
  let calls = 0
  const first = signedRequest({ type: 'transactions.updated' })
  const accepted = await processWebhook({ request: first.request, provider: 'gocardless', secret, store, now: new Date('2026-07-28T19:02:00.000Z'), handler: async () => { calls += 1 } })
  const second = signedRequest({ type: 'transactions.updated' })
  const duplicate = await processWebhook({ request: second.request, provider: 'gocardless', secret, store, now: new Date('2026-07-28T19:02:00.000Z'), handler: async () => { calls += 1 } })
  assert.equal(accepted.duplicate, false)
  assert.equal(duplicate.duplicate, true)
  assert.equal(calls, 1)
})

test('does not acknowledge an in-flight duplicate as completed', async () => {
  const store = {
    async claimWebhookEvent() { return undefined },
    async getWebhookEventState() { return 'processing' },
  }
  const delivery = signedRequest({ type: 'transactions.updated' })
  await assert.rejects(
    processWebhook({ request: delivery.request, provider: 'gocardless', secret, store, now: new Date('2026-07-28T19:02:00.000Z'), handler: async () => {} }),
    (error) => error?.status === 503 && error?.code === 'webhook_processing',
  )
})

test('production capabilities require durable storage and webhook secrets', () => {
  const result = bankProductionCapabilities({ NODE_ENV: 'production', PUBLIC_DEPLOYMENT: 'true', GOCARDLESS_SECRET_ID: 'id', GOCARDLESS_SECRET_KEY: 'key' }, { driver: 'file' })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes('postgres_persistence_required'))
  assert.ok(result.blockers.includes('gocardless_webhook_secret_required'))
})