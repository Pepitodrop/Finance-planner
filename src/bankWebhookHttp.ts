import type { BankWebhookRepository, BankWebhookResult } from './bankWebhook'
import { processBankWebhook } from './bankWebhook'

export interface BankWebhookHttpRequest {
  method: string
  headers: Record<string, string | undefined>
  rawBody: string
}

export interface BankWebhookHttpResponse {
  status: number
  body: { accepted: boolean; action?: BankWebhookResult['action']; error?: string }
}

export interface BankWebhookProviderConfig {
  provider: string
  secret: Uint8Array
  signatureHeader: string
  maxBodyBytes?: number
}

export interface BankWebhookTelemetry {
  record(input: {
    provider: string
    outcome: 'accepted' | 'ignored' | 'failed'
    action?: BankWebhookResult['action']
    eventId?: string
    durationMs: number
    error?: string
  }): Promise<void> | void
}

export interface BankWebhookDeadLetterStore {
  save(input: {
    provider: string
    rawBody: string
    signatureHex: string
    failedAt: string
    attempts: number
    error: string
  }): Promise<void>
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const target = name.toLowerCase()
  return Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1]
}

function eventId(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : undefined
  } catch {
    return undefined
  }
}

export async function handleBankWebhookHttp(input: {
  request: BankWebhookHttpRequest
  config: BankWebhookProviderConfig
  repository: BankWebhookRepository
  scheduleSyncOnce: (consentId: string, eventId: string) => Promise<boolean>
  telemetry?: BankWebhookTelemetry
  deadLetters?: BankWebhookDeadLetterStore
  now?: Date
}): Promise<BankWebhookHttpResponse> {
  const startedAt = Date.now()
  const provider = input.config.provider
  const id = eventId(input.request.rawBody)
  const record = async (outcome: 'accepted' | 'ignored' | 'failed', details: { action?: BankWebhookResult['action']; error?: string } = {}) => {
    await input.telemetry?.record({ provider, outcome, action: details.action, eventId: id, durationMs: Date.now() - startedAt, error: details.error })
  }

  if (input.request.method.toUpperCase() !== 'POST') {
    await record('ignored', { error: 'method-not-allowed' })
    return { status: 405, body: { accepted: false, error: 'method-not-allowed' } }
  }

  const contentType = header(input.request.headers, 'content-type')?.split(';')[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    await record('ignored', { error: 'unsupported-media-type' })
    return { status: 415, body: { accepted: false, error: 'unsupported-media-type' } }
  }

  const bodyBytes = new TextEncoder().encode(input.request.rawBody).byteLength
  if (bodyBytes > (input.config.maxBodyBytes ?? 256_000)) {
    await record('ignored', { error: 'payload-too-large' })
    return { status: 413, body: { accepted: false, error: 'payload-too-large' } }
  }

  const signatureHex = header(input.request.headers, input.config.signatureHeader)
  if (!signatureHex) {
    await record('ignored', { error: 'signature-missing' })
    return { status: 401, body: { accepted: false, error: 'signature-missing' } }
  }

  try {
    const result = await processBankWebhook({
      rawBody: input.request.rawBody,
      signatureHex,
      secret: input.config.secret,
      repository: input.repository,
      scheduleSyncOnce: input.scheduleSyncOnce,
      now: input.now,
    })
    await record(result.accepted ? 'accepted' : 'ignored', { action: result.action })
    return { status: 200, body: { accepted: result.accepted, action: result.action } }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown webhook processing error'
    await input.deadLetters?.save({
      provider,
      rawBody: input.request.rawBody,
      signatureHex,
      failedAt: (input.now ?? new Date()).toISOString(),
      attempts: 1,
      error: message,
    })
    await record('failed', { error: message })
    return { status: 503, body: { accepted: false, error: 'processing-failed' } }
  }
}

export async function replayBankWebhookDeadLetter(input: {
  provider: string
  rawBody: string
  signatureHex: string
  secret: Uint8Array
  repository: BankWebhookRepository
  scheduleSyncOnce: (consentId: string, eventId: string) => Promise<boolean>
  now?: Date
}): Promise<BankWebhookResult> {
  return processBankWebhook({
    rawBody: input.rawBody,
    signatureHex: input.signatureHex,
    secret: input.secret,
    repository: input.repository,
    scheduleSyncOnce: input.scheduleSyncOnce,
    now: input.now,
  })
}
