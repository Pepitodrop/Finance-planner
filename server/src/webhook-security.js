import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from './runtime-security.js'

const MAX_WEBHOOK_BYTES = 512_000
const DEFAULT_TOLERANCE_SECONDS = 300
const DEFAULT_LEASE_SECONDS = 60

function header(request, name) {
  const value = request.headers[name.toLowerCase()]
  return Array.isArray(value) ? value[0] : String(value || '')
}

function safeEqual(left, right) {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function readWebhookBody(request) {
  const contentType = header(request, 'content-type').split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new HttpError(415, 'unsupported_media_type', 'Webhook Content-Type must be application/json.')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > MAX_WEBHOOK_BYTES) throw new HttpError(413, 'payload_too_large', 'Webhook payload too large.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function verifyWebhookRequest({ request, rawBody, provider, secret, now = Date.now(), toleranceSeconds = DEFAULT_TOLERANCE_SECONDS }) {
  if (!secret || secret.length < 32) throw new HttpError(503, 'webhook_not_configured', `${provider} webhook secret is not configured.`)
  const timestamp = header(request, 'x-webhook-timestamp')
  const signatureHeader = header(request, 'x-webhook-signature')
  const eventId = header(request, 'x-webhook-id') || header(request, 'x-event-id')
  if (!timestamp || !signatureHeader || !eventId) throw new HttpError(400, 'invalid_webhook_headers', 'Webhook timestamp, signature, and event ID are required.')
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(eventId)) throw new HttpError(400, 'invalid_webhook_event_id', 'Webhook event ID is invalid.')

  const timestampMs = /^\d{10}$/.test(timestamp) ? Number(timestamp) * 1000 : Date.parse(timestamp)
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > toleranceSeconds * 1000) {
    throw new HttpError(401, 'stale_webhook', 'Webhook timestamp is outside the accepted replay window.')
  }

  const supplied = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader
  if (!/^[a-fA-F0-9]{64}$/.test(supplied)) throw new HttpError(401, 'invalid_webhook_signature', 'Webhook signature is invalid.')
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(rawBody).digest('hex')
  if (!safeEqual(expected.toLowerCase(), supplied.toLowerCase())) throw new HttpError(401, 'invalid_webhook_signature', 'Webhook signature is invalid.')

  return { eventId, occurredAt: new Date(timestampMs).toISOString() }
}

export async function processWebhook({ request, provider, secret, store, handler, now = new Date(), leaseSeconds = DEFAULT_LEASE_SECONDS }) {
  const rawBody = await readWebhookBody(request)
  const verified = verifyWebhookRequest({ request, rawBody, provider, secret, now: now.getTime() })
  let payload
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw new HttpError(400, 'invalid_json', 'Invalid webhook JSON payload.')
  }

  const leaseToken = await store.claimWebhookEvent({
    provider,
    eventId: verified.eventId,
    occurredAt: verified.occurredAt,
    now: now.toISOString(),
    leaseUntil: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
  })
  if (!leaseToken) {
    if (typeof store.getWebhookEventState !== 'function') throw new Error('Webhook store does not expose delivery state.')
    const state = await store.getWebhookEventState(provider, verified.eventId, now)
    if (state === 'completed') return { accepted: true, duplicate: true, eventId: verified.eventId }
    throw new HttpError(503, 'webhook_processing', 'A matching webhook delivery is still being processed; retry later.')
  }

  try {
    await handler({ provider, eventId: verified.eventId, occurredAt: verified.occurredAt, payload })
    const completed = await store.completeWebhookEvent({ provider, eventId: verified.eventId, leaseToken, completedAt: new Date().toISOString() })
    if (!completed) throw new Error('Webhook lease could not be completed.')
    return { accepted: true, duplicate: false, eventId: verified.eventId }
  } catch (error) {
    await store.releaseWebhookEvent({ provider, eventId: verified.eventId, leaseToken }).catch(() => {})
    throw error
  }
}

export function bankProductionCapabilities(env, persistence) {
  const production = env.NODE_ENV === 'production' && env.PUBLIC_DEPLOYMENT === 'true'
  const configuredProviders = {
    gocardless: Boolean(env.GOCARDLESS_SECRET_ID && env.GOCARDLESS_SECRET_KEY),
    paypal: Boolean(env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET),
    finapi: Boolean(env.FINAPI_CLIENT_ID && env.FINAPI_CLIENT_SECRET),
  }
  const webhookVerification = {
    gocardless: Boolean(env.GOCARDLESS_WEBHOOK_SECRET?.length >= 32),
    paypal: Boolean(env.PAYPAL_WEBHOOK_SECRET?.length >= 32),
    finapi: Boolean(env.FINAPI_WEBHOOK_SECRET?.length >= 32),
  }
  const blockers = []
  if (production && persistence.driver !== 'postgres') blockers.push('postgres_persistence_required')
  if (production && !Object.values(configuredProviders).some(Boolean)) blockers.push('provider_credentials_required')
  for (const provider of Object.keys(configuredProviders)) {
    if (configuredProviders[provider] && !webhookVerification[provider]) blockers.push(`${provider}_webhook_secret_required`)
  }
  return {
    production,
    persistence: persistence.driver,
    encryptedCredentials: true,
    oauthReplayProtection: true,
    webhookVerification,
    webhookIdempotency: true,
    configuredProviders,
    ready: blockers.length === 0,
    blockers,
  }
}