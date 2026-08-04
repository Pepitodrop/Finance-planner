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

test('core readiness remains independent when no automatic bank provider is configured', () => {
  const result = bankProductionCapabilities({ NODE_ENV: 'production', PUBLIC_DEPLOYMENT: 'true' }, { driver: 'postgres' })
  assert.equal(result.deploymentProduction, true)
  assert.equal(result.production, false)
  assert.equal(result.coreReadinessDependency, false)
  assert.equal(result.automaticMonitoringConfigured, false)
  assert.equal(result.ready, false)
  assert.ok(result.blockers.includes('provider_credentials_required'))
  assert.equal(result.readOnly, true)
  assert.equal(result.paymentInitiation, false)
})

test('polling-based GoCardless monitoring stays optional for core readiness', () => {
  const result = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    GOCARDLESS_SECRET_ID: 'id',
    GOCARDLESS_SECRET_KEY: 'key',
  }, { driver: 'postgres' })
  assert.equal(result.configuredProviders.gocardless, true)
  assert.equal(result.webhookRequired.gocardless, false)
  assert.equal(result.ready, true)
  assert.equal(result.production, false)
  assert.equal(result.coreReadinessDependency, false)
})

test('configured automatic monitoring still requires durable PostgreSQL storage', () => {
  const result = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    GOCARDLESS_SECRET_ID: 'id',
    GOCARDLESS_SECRET_KEY: 'key',
  }, { driver: 'file' })
  assert.equal(result.ready, false)
  assert.equal(result.production, false)
  assert.ok(result.blockers.includes('postgres_persistence_required'))
})

test('PayPal owner-account monitoring requires only application reporting credentials', () => {
  const owner = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_CONNECTION_MODE: 'owner',
  }, { driver: 'postgres' })
  assert.equal(owner.paypalMode, 'owner')
  assert.equal(owner.configuredProviders.paypal, true)
  assert.equal(owner.webhookRequired.paypal, false)
  assert.equal(owner.ready, true)
  assert.equal(owner.production, false)
})

test('PayPal partner mode requires approved onboarding and webhook verification', () => {
  const incomplete = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_CONNECTION_MODE: 'partner',
  }, { driver: 'postgres' })
  assert.equal(incomplete.configuredProviders.paypal, false)
  assert.ok(incomplete.blockers.includes('provider_credentials_required'))

  const missingWebhook = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_CONNECTION_MODE: 'partner',
    PAYPAL_PARTNER_MERCHANT_ID: 'partner',
  }, { driver: 'postgres' })
  assert.equal(missingWebhook.configuredProviders.paypal, true)
  assert.ok(missingWebhook.blockers.includes('paypal_webhook_secret_required'))

  const complete = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    PAYPAL_CLIENT_ID: 'client',
    PAYPAL_CLIENT_SECRET: 'secret',
    PAYPAL_CONNECTION_MODE: 'partner',
    PAYPAL_PARTNER_MERCHANT_ID: 'partner',
    PAYPAL_WEBHOOK_SECRET: secret,
  }, { driver: 'postgres' })
  assert.equal(complete.ready, true)
  assert.equal(complete.production, false)
})

test('finAPI credentials cannot make an unimplemented adapter look ready', () => {
  const result = bankProductionCapabilities({
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    FINAPI_CLIENT_ID: 'client',
    FINAPI_CLIENT_SECRET: 'secret',
    FINAPI_WEBHOOK_SECRET: secret,
  }, { driver: 'postgres' })
  assert.equal(result.configuredProviders.finapi, false)
  assert.ok(result.blockers.includes('provider_credentials_required'))
  assert.ok(result.blockers.includes('finapi_adapter_not_implemented'))
  assert.equal(result.production, false)
})
