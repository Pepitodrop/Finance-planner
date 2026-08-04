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
    throw new HttpError(400, 'invalid_json', 'Invalid JSON webhook payload.')
  }

  // Lease-based webhook idempotency prevents duplicate side effects while
  // preserving a safe retry path for failed or abandoned deliveries.
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

function paypalConnectionMode(env) {
  const configured = String(env.PAYPAL_CONNECTION_MODE || '').trim().toLowerCase()
  if (configured === 'owner' || configured === 'partner') return configured
  return env.PAYPAL_PARTNER_MERCHANT_ID ? 'partner' : 'owner'
}

function defaultProviderDescriptions(env) {
  const paypalMode = paypalConnectionMode(env)
  return [
    {
      id: 'gocardless',
      available: true,
      configured: Boolean(env.GOCARDLESS_SECRET_ID && env.GOCARDLESS_SECRET_KEY),
      webhookRequired: false,
    },
    {
      id: 'paypal',
      available: true,
      configured: Boolean(
        env.PAYPAL_CLIENT_ID
        && env.PAYPAL_CLIENT_SECRET
        && (paypalMode === 'owner' || env.PAYPAL_PARTNER_MERCHANT_ID),
      ),
      webhookRequired: paypalMode === 'partner',
      mode: paypalMode,
    },
    { id: 'finapi', available: false, configured: false, webhookRequired: false },
  ]
}

function webhookSecretKey(providerId) {
  return `${String(providerId).toUpperCase().replaceAll('-', '_')}_WEBHOOK_SECRET`
}

export function bankProductionCapabilities(env, persistence, providerRegistry) {
  const deploymentProduction = env.NODE_ENV === 'production' && env.PUBLIC_DEPLOYMENT === 'true'
  const providers = providerRegistry?.list?.() || defaultProviderDescriptions(env)
  const configuredProviders = Object.fromEntries(providers.map((provider) => [
    provider.id,
    Boolean(provider.available !== false && provider.configured),
  ]))
  const webhookRequired = Object.fromEntries(providers.map((provider) => [provider.id, Boolean(provider.webhookRequired)]))
  const webhookVerification = Object.fromEntries(providers.map((provider) => [
    provider.id,
    Boolean(env[webhookSecretKey(provider.id)]?.length >= 32),
  ]))
  const automaticMonitoringConfigured = Object.values(configuredProviders).some(Boolean)
  const blockers = []
  if (automaticMonitoringConfigured && deploymentProduction && persistence.driver !== 'postgres') blockers.push('postgres_persistence_required')
  if (!automaticMonitoringConfigured) blockers.push('provider_credentials_required')
  for (const provider of providers) {
    if (configuredProviders[provider.id] && webhookRequired[provider.id] && !webhookVerification[provider.id]) {
      blockers.push(`${provider.id}_webhook_secret_required`)
    }
  }
  if (deploymentProduction && (env.FINAPI_CLIENT_ID || env.FINAPI_CLIENT_SECRET || env.FINAPI_WEBHOOK_SECRET)) blockers.push('finapi_adapter_not_implemented')

  const paypal = providers.find((provider) => provider.id === 'paypal')
  return {
    deploymentProduction,
    // server.js uses this field to decide whether bank capability is a core
    // readiness dependency. No provider means optional monitoring is disabled,
    // not that the core application is unhealthy.
    production: automaticMonitoringConfigured,
    automaticMonitoringConfigured,
    persistence: persistence.driver,
    encryptedCredentials: true,
    oauthReplayProtection: true,
    readOnly: true,
    paymentInitiation: false,
    transfers: false,
    payouts: false,
    webhookVerification,
    webhookRequired,
    webhookIdempotency: true,
    paypalMode: paypal?.mode || paypalConnectionMode(env),
    configuredProviders,
    providers,
    ready: automaticMonitoringConfigured && blockers.length === 0,
    blockers,
  }
}
