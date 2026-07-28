import { describe, expect, it, vi } from 'vitest'
import type { BankConsent } from './bankRuntime'
import { handleBankWebhookHttp, replayBankWebhookDeadLetter } from './bankWebhookHttp'

const encoder = new TextEncoder()

async function signature(body: string, secret: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const consent: BankConsent = {
  id: 'consent-1',
  userId: 'user-1',
  provider: 'gocardless',
  status: 'active',
  expiresAt: '2026-08-01T00:00:00.000Z',
  providerConnectionId: 'connection-1',
  updatedAt: '2026-07-28T00:00:00.000Z',
}

function repository() {
  const processed = new Set<string>()
  return {
    getConsent: vi.fn(),
    saveConsent: vi.fn(),
    hasWebhookEvent: vi.fn(async (id: string) => processed.has(id)),
    commitWebhookEvent: vi.fn(async (id: string) => { if (processed.has(id)) return false; processed.add(id); return true }),
    commitSyncPage: vi.fn(),
    findConsentByProviderConnection: vi.fn(async () => consent),
  }
}

function body(occurredAt = '2026-07-28T12:00:00.000Z') {
  return JSON.stringify({
    id: 'event-1',
    type: 'transactions.available',
    occurredAt,
    provider: 'gocardless',
    connectionId: 'connection-1',
  })
}

describe('bank webhook HTTP operations', () => {
  it('accepts an exact signed JSON body and records telemetry', async () => {
    const secret = encoder.encode('secret')
    const rawBody = body()
    const telemetry = { record: vi.fn() }
    const scheduleSyncOnce = vi.fn(async () => true)

    const response = await handleBankWebhookHttp({
      request: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Bank-Signature': await signature(rawBody, secret) },
        rawBody,
      },
      config: { provider: 'gocardless', secret, signatureHeader: 'x-bank-signature' },
      repository: repository(),
      scheduleSyncOnce,
      telemetry,
      now: new Date('2026-07-28T12:01:00.000Z'),
    })

    expect(response).toEqual({ status: 200, body: { accepted: true, action: 'sync-scheduled' } })
    expect(scheduleSyncOnce).toHaveBeenCalledWith('consent-1', 'event-1')
    expect(telemetry.record).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gocardless', outcome: 'accepted', eventId: 'event-1' }))
  })

  it('rejects missing signatures and oversized payloads before processing', async () => {
    const secret = encoder.encode('secret')
    const repo = repository()
    const scheduleSyncOnce = vi.fn(async () => true)

    const missing = await handleBankWebhookHttp({
      request: { method: 'POST', headers: { 'content-type': 'application/json' }, rawBody: body() },
      config: { provider: 'gocardless', secret, signatureHeader: 'x-bank-signature' },
      repository: repo,
      scheduleSyncOnce,
    })
    expect(missing.status).toBe(401)

    const oversized = await handleBankWebhookHttp({
      request: { method: 'POST', headers: { 'content-type': 'application/json', 'x-bank-signature': '00' }, rawBody: body() },
      config: { provider: 'gocardless', secret, signatureHeader: 'x-bank-signature', maxBodyBytes: 4 },
      repository: repo,
      scheduleSyncOnce,
    })
    expect(oversized.status).toBe(413)
    expect(scheduleSyncOnce).not.toHaveBeenCalled()
  })

  it('dead-letters transient processing failures and returns a retryable response', async () => {
    const secret = encoder.encode('secret')
    const rawBody = body()
    const deadLetters = { save: vi.fn(async () => undefined) }

    const response = await handleBankWebhookHttp({
      request: { method: 'POST', headers: { 'content-type': 'application/json', 'x-bank-signature': await signature(rawBody, secret) }, rawBody },
      config: { provider: 'gocardless', secret, signatureHeader: 'x-bank-signature' },
      repository: repository(),
      scheduleSyncOnce: vi.fn(async () => { throw new Error('queue unavailable') }),
      deadLetters,
      now: new Date('2026-07-28T12:01:00.000Z'),
    })

    expect(response).toEqual({ status: 503, body: { accepted: false, error: 'processing-failed' } })
    expect(deadLetters.save).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gocardless', attempts: 1, error: 'queue unavailable' }))
  })

  it('replays an old dead-letter under a bounded operator policy while preserving signature checks', async () => {
    const secret = encoder.encode('secret')
    const rawBody = body('2026-07-27T12:00:00.000Z')
    const scheduleSyncOnce = vi.fn(async () => true)

    const result = await replayBankWebhookDeadLetter({
      provider: 'gocardless',
      rawBody,
      signatureHex: await signature(rawBody, secret),
      secret,
      repository: repository(),
      scheduleSyncOnce,
      now: new Date('2026-07-28T12:01:00.000Z'),
    })

    expect(result).toEqual({ accepted: true, action: 'sync-scheduled', consentId: 'consent-1' })
    expect(scheduleSyncOnce).toHaveBeenCalledTimes(1)

    const invalid = await replayBankWebhookDeadLetter({
      provider: 'gocardless',
      rawBody,
      signatureHex: '00',
      secret,
      repository: repository(),
      scheduleSyncOnce,
      now: new Date('2026-07-28T12:01:00.000Z'),
    })
    expect(invalid).toEqual({ accepted: false, action: 'ignored' })
  })

  it('rejects operator replay beyond its configured maximum event age', async () => {
    const secret = encoder.encode('secret')
    const rawBody = body('2026-07-27T12:00:00.000Z')
    const scheduleSyncOnce = vi.fn(async () => true)

    const result = await replayBankWebhookDeadLetter({
      provider: 'gocardless',
      rawBody,
      signatureHex: await signature(rawBody, secret),
      secret,
      repository: repository(),
      scheduleSyncOnce,
      now: new Date('2026-07-28T12:01:00.000Z'),
      maxEventAgeMs: 60 * 60_000,
    })

    expect(result).toEqual({ accepted: false, action: 'ignored' })
    expect(scheduleSyncOnce).not.toHaveBeenCalled()
  })
})
