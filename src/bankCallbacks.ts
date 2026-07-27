import {
  connectBank,
  verifyOAuthState,
  type AesGcmTokenVault,
  type BankConsent,
  type BankProviderAdapter,
  type BankRuntimeRepository,
  type OAuthStateClaims,
} from './bankRuntime'

const encoder = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

async function importHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

export interface ConsentBoundOAuthStateClaims extends OAuthStateClaims {
  consentId: string
}

export interface OAuthNonceRepository {
  /** Must atomically consume the nonce. False means used, unknown, or expired. */
  consumeNonce(input: {
    nonce: string
    consentId: string
    userId: string
    provider: string
    expiresAt: number
    now: number
  }): Promise<boolean>
}

export interface BankTelemetry {
  increment(metric: string, tags?: Record<string, string>): void
  observe(metric: string, value: number, tags?: Record<string, string>): void
  error(error: unknown, context: Record<string, string>): void
}

export const noOpBankTelemetry: BankTelemetry = {
  increment() {},
  observe() {},
  error() {},
}

export async function completeBankCallback(input: {
  state: string
  stateSecret: Uint8Array
  expected: { userId: string; provider: string; redirectUri: string }
  nonceRepository: OAuthNonceRepository
  consentId: string
  provider: BankProviderAdapter
  repository: BankRuntimeRepository
  vault: AesGcmTokenVault
  now?: Date
  telemetry?: BankTelemetry
}): Promise<BankConsent> {
  const now = input.now ?? new Date()
  const telemetry = input.telemetry ?? noOpBankTelemetry
  const startedAt = performance.now()

  try {
    const claims = await verifyOAuthState(input.state, input.stateSecret, input.expected, now.getTime()) as ConsentBoundOAuthStateClaims
    if (!claims.consentId || claims.consentId !== input.consentId) {
      throw new Error('OAuth state does not match the requested bank consent.')
    }

    const consumed = await input.nonceRepository.consumeNonce({
      nonce: claims.nonce,
      consentId: claims.consentId,
      userId: claims.userId,
      provider: claims.provider,
      expiresAt: claims.expiresAt,
      now: now.getTime(),
    })
    if (!consumed) throw new Error('OAuth state nonce was already used or expired.')

    const consent = await input.repository.getConsent(claims.consentId)
    if (!consent) throw new Error('Bank consent was not found.')
    if (consent.id !== claims.consentId || consent.userId !== claims.userId || consent.provider !== claims.provider) {
      throw new Error('OAuth state does not match the bank consent.')
    }

    const connected = await connectBank({
      consentId: claims.consentId,
      provider: input.provider,
      repository: input.repository,
      vault: input.vault,
      now,
    })
    telemetry.increment('bank.callback.completed', { provider: claims.provider })
    return connected
  } catch (error) {
    telemetry.increment('bank.callback.failed', { provider: input.expected.provider })
    telemetry.error(error, { operation: 'completeBankCallback', provider: input.expected.provider })
    throw error
  } finally {
    telemetry.observe('bank.callback.duration_ms', performance.now() - startedAt, { provider: input.expected.provider })
  }
}

export interface SignedBankWebhook {
  id: string
  occurredAt: string
  rawBody: string
  signature: string
}

export interface BankWebhookLeaseRepository {
  /** Atomically claims an event and returns a unique fencing token. */
  claimWebhookEvent(input: { eventId: string; occurredAt: string; leaseUntil: string }): Promise<string | undefined>
  /** Must only complete when the supplied token still owns the active lease. */
  completeWebhookEvent(input: { eventId: string; leaseToken: string; completedAt: string }): Promise<boolean>
  /** Must only release when the supplied token still owns the active lease. */
  releaseWebhookEvent(input: { eventId: string; leaseToken: string }): Promise<boolean>
}

export async function signBankWebhook(input: {
  event: Omit<SignedBankWebhook, 'signature'>
  secret: Uint8Array
}): Promise<string> {
  const payload = `${input.event.occurredAt}.${input.event.id}.${input.event.rawBody}`
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', await importHmacKey(input.secret), encoder.encode(payload)),
  )
  return `v1=${bytesToBase64(signature)}`
}

export async function verifyBankWebhookSignature(input: {
  event: SignedBankWebhook
  secret: Uint8Array
}): Promise<boolean> {
  if (!input.event.signature.startsWith('v1=')) return false
  let supplied: Uint8Array
  try {
    supplied = base64ToBytes(input.event.signature.slice(3))
  } catch {
    return false
  }
  const expected = await signBankWebhook({
    event: { id: input.event.id, occurredAt: input.event.occurredAt, rawBody: input.event.rawBody },
    secret: input.secret,
  })
  return timingSafeEqual(supplied, base64ToBytes(expected.slice(3)))
}

export async function processBankWebhook(input: {
  event: SignedBankWebhook
  secret: Uint8Array
  repository: BankWebhookLeaseRepository
  handler: (event: SignedBankWebhook) => Promise<void>
  now?: Date
  replayWindowMs?: number
  leaseMs?: number
  telemetry?: BankTelemetry
}): Promise<'processed' | 'duplicate' | 'rejected'> {
  const now = input.now ?? new Date()
  const telemetry = input.telemetry ?? noOpBankTelemetry
  const occurredAt = Date.parse(input.event.occurredAt)

  if (
    !input.event.id ||
    !Number.isFinite(occurredAt) ||
    occurredAt > now.getTime() ||
    now.getTime() - occurredAt > (input.replayWindowMs ?? 5 * 60_000) ||
    !(await verifyBankWebhookSignature({ event: input.event, secret: input.secret }))
  ) {
    telemetry.increment('bank.webhook.rejected')
    return 'rejected'
  }

  const leaseToken = await input.repository.claimWebhookEvent({
    eventId: input.event.id,
    occurredAt: input.event.occurredAt,
    leaseUntil: new Date(now.getTime() + (input.leaseMs ?? 60_000)).toISOString(),
  })
  if (!leaseToken) {
    telemetry.increment('bank.webhook.duplicate')
    return 'duplicate'
  }

  const startedAt = performance.now()
  try {
    await input.handler(input.event)
    const completed = await input.repository.completeWebhookEvent({
      eventId: input.event.id,
      leaseToken,
      completedAt: now.toISOString(),
    })
    if (!completed) throw new Error('Webhook lease ownership was lost before completion.')
    telemetry.increment('bank.webhook.processed')
    return 'processed'
  } catch (error) {
    await input.repository.releaseWebhookEvent({ eventId: input.event.id, leaseToken })
    telemetry.increment('bank.webhook.failed')
    telemetry.error(error, { operation: 'processBankWebhook', eventId: input.event.id })
    throw error
  } finally {
    telemetry.observe('bank.webhook.duration_ms', performance.now() - startedAt)
  }
}
