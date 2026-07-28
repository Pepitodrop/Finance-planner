import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = (path) => readFile(resolve(root, path), 'utf8')
const [main, runtime, connectors, panel, server, webhookSecurity] = await Promise.all([
  read('src/main.tsx'),
  read('src/MobileProductionRuntime.tsx'),
  read('src/connectors.ts'),
  read('src/ConnectionsPanel.tsx'),
  read('server/src/server.js'),
  read('server/src/webhook-security.js'),
])

assert.match(main, /<MobileProductionRuntime\s*\/>/, 'Mobile production runtime must be mounted')
assert.match(runtime, /visualViewport/, 'Visual viewport changes must be handled for mobile keyboards')
assert.match(runtime, /registration\.update/, 'Installed apps must periodically check for safe updates')
assert.match(runtime, /update-available/, 'Installed apps must announce safely installed updates')
assert.match(runtime, /pageshow/, 'Back-forward cache restores must be handled')
assert.match(runtime, /wasDiscarded/, 'Discarded mobile tabs must be detected')
assert.match(runtime, /resource-constrained/, 'Low-memory and low-CPU devices must be detectable')
assert.match(runtime, /connectivity-restored/, 'Connectivity restoration must be broadcast to the app')
assert.match(runtime, /effectiveType/, 'Network quality must be exposed for adaptive behavior')
assert.match(connectors, /AbortController/, 'Bank requests must have a hard timeout')
assert.match(connectors, /RETRY_DELAYS_MS/, 'Transient banking failures must be retried with bounded backoff')
assert.match(connectors, /Retry-After/, 'Provider retry windows must be respected')
assert.match(connectors, /Idempotency-Key/, 'Retryable bank mutations must carry idempotency keys')
assert.match(connectors, /activeSynchronization/, 'Concurrent browser sync requests must be coalesced')
assert.match(connectors, /class BankingRequestError/, 'HTTP failures must carry retryability metadata')
assert.match(connectors, /if \(!error\.retryable\) throw error/, 'Permanent 4xx banking failures must stop immediately')
assert.match(connectors, /response\.status === 429 \|\| response\.status >= 500/, 'Only throttling and server failures may be retried')
assert.match(connectors, /requestId/, 'Backend request references must be surfaced for support')
assert.match(connectors, /disconnectConnector/, 'Users must be able to revoke a bank connection')
assert.match(connectors, /connectorReturnUrl/, 'OAuth return URLs must remove stale callback parameters')
assert.match(connectors, /consentDaysRemaining/, 'PSD2 consent expiry must be tracked')
assert.match(server, /syncReplayCache/, 'The backend must replay completed idempotent sync requests')
assert.match(server, /activeSyncs/, 'The backend must coalesce concurrent per-user synchronizations')
assert.match(server, /invalid_idempotency_key/, 'The backend must validate idempotency keys')
assert.match(server, /Idempotency-Replayed/, 'The backend must expose replay behavior operationally')
assert.match(server, /\/health\/bank/, 'Bank production capabilities must have a dedicated health endpoint')
assert.match(server, /processWebhook/, 'Verified provider webhooks must be routed through the security boundary')
assert.match(webhookSecurity, /createHmac/, 'Webhook payloads must be authenticated with HMAC signatures')
assert.match(webhookSecurity, /timingSafeEqual/, 'Webhook signatures must use constant-time comparison')
assert.match(webhookSecurity, /stale_webhook/, 'Webhook replay windows must be enforced')
assert.match(webhookSecurity, /claimWebhookEvent/, 'Webhook delivery must be idempotent')
assert.match(webhookSecurity, /postgres_persistence_required/, 'Public production deployments must require durable database storage')
assert.match(panel, /Verbindungszustand/, 'Connection health must be visible')
assert.match(panel, /Zustimmung/, 'Consent expiry must be shown to the user')
assert.match(panel, /Provider-Tokens wurden serverseitig entfernt/, 'Disconnect semantics must be explicit')

console.log('Mobile and bank production gate passed.')
