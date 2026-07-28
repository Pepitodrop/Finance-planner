import { describe, expect, it, vi } from 'vitest'
import type { BankConsent } from './bankRuntime'
import { parseBankWebhook, processBankWebhook, verifyBankWebhookSignature } from './bankWebhook'

const encoder = new TextEncoder()

async function signature(body: string, secret: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(body)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function repository(consent?: BankConsent) {
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

function idempotentScheduler() {
  const queued = new Set<string>()
  return vi.fn(async (_consentId: string, eventId: string) => {
    if (queued.has(eventId)) return false
    queued.add(eventId)
    return true
  })
}

const activeConsent: BankConsent = {
  id: 'consent-1', userId: 'user-1', provider: 'gocardless', status: 'active',
  expiresAt: '2026-08-01T00:00:00.000Z', providerConnectionId: 'connection-1', updatedAt: '2026-07-28T00:00:00.000Z',
}

function event(type: string, occurredAt = '2026-07-28T12:00:00.000Z') {
  return JSON.stringify({ id: `event-${type}`, type, occurredAt, provider: 'gocardless', connectionId: 'connection-1' })
}

describe('bank webhook security and orchestration', () => {
  it('verifies signatures over the exact raw request body', async () => {
    const secret = encoder.encode('webhook-secret')
    const body = event('transactions.available')
    expect(await verifyBankWebhookSignature(body, await signature(body, secret), secret)).toBe(true)
    expect(await verifyBankWebhookSignature(`${body} `, await signature(body, secret), secret)).toBe(false)
  })

  it('rejects unsupported event types', () => {
    expect(() => parseBankWebhook(event('unknown.event'))).toThrow('Unsupported bank webhook type.')
  })

  it('accepts a transaction event once and schedules one sync', async () => {
    const secret = encoder.encode('webhook-secret')
    const body = event('transactions.available')
    const repo = repository(activeConsent)
    const scheduleSyncOnce = idempotentScheduler()
    const input = { rawBody: body, signatureHex: await signature(body, secret), secret, repository: repo, scheduleSyncOnce, now: new Date('2026-07-28T12:01:00.000Z') }

    expect(await processBankWebhook(input)).toEqual({ accepted: true, action: 'sync-scheduled', consentId: 'consent-1' })
    expect(await processBankWebhook(input)).toEqual({ accepted: false, action: 'ignored' })
    expect(scheduleSyncOnce).toHaveBeenCalledTimes(1)
  })

  it('leaves a failed scheduling attempt retryable until it succeeds', async () => {
    const secret = encoder.encode('webhook-secret')
    const body = event('transactions.available')
    const repo = repository(activeConsent)
    const scheduleSyncOnce = vi.fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(true)
    const input = { rawBody: body, signatureHex: await signature(body, secret), secret, repository: repo, scheduleSyncOnce, now: new Date('2026-07-28T12:01:00.000Z') }

    await expect(processBankWebhook(input)).rejects.toThrow('queue unavailable')
    expect(repo.commitWebhookEvent).not.toHaveBeenCalled()
    await expect(processBankWebhook(input)).resolves.toEqual({ accepted: true, action: 'sync-scheduled', consentId: 'consent-1' })
    expect(scheduleSyncOnce).toHaveBeenCalledTimes(2)
    expect(repo.commitWebhookEvent).toHaveBeenCalledTimes(1)
  })

  it('does not duplicate a sync if event persistence fails after scheduling', async () => {
    const secret = encoder.encode('webhook-secret')
    const body = event('transactions.available')
    const repo = repository(activeConsent)
    repo.commitWebhookEvent
      .mockRejectedValueOnce(new Error('event store unavailable'))
      .mockResolvedValueOnce(true)
    const scheduleSyncOnce = idempotentScheduler()
    const input = { rawBody: body, signatureHex: await signature(body, secret), secret, repository: repo, scheduleSyncOnce, now: new Date('2026-07-28T12:01:00.000Z') }

    await expect(processBankWebhook(input)).rejects.toThrow('event store unavailable')
    await expect(processBankWebhook(input)).resolves.toEqual({ accepted: true, action: 'sync-scheduled', consentId: 'consent-1' })
    expect(scheduleSyncOnce).toHaveBeenCalledTimes(2)
    expect(await scheduleSyncOnce.mock.results[1].value).toBe(false)
  })

  it('keeps concurrent duplicate deliveries to one queued sync', async () => {
    const secret = encoder.encode('webhook-secret')
    const body = event('transactions.available')
    const repo = repository(activeConsent)
    const scheduleSyncOnce = idempotentScheduler()
    const input = { rawBody: body, signatureHex: await signature(body, secret), secret, repository: repo, scheduleSyncOnce, now: new Date('2026-07-28T12:01:00.000Z') }

    await Promise.allSettled([processBankWebhook(input), processBankWebhook(input)])
    const created = await Promise.all(scheduleSyncOnce.mock.results.map((result) => result.value))
    expect(created.filter(Boolean)).toHaveLength(1)
  })

  it('revokes consent and clears credentials without scheduling sync', async () => {
    const secret = encoder.encode('webhook-secret')
    const body = event('consent.revoked')
    const repo = repository({ ...activeConsent, encryptedAccessToken: { keyId: 'k', iv: 'i', ciphertext: 'c' } })
    const scheduleSyncOnce = idempotentScheduler()

    const result = await processBankWebhook({ rawBody: body, signatureHex: await signature(body, secret), secret, repository: repo, scheduleSyncOnce, now: new Date('2026-07-28T12:01:00.000Z') })
    expect(result.action).toBe('consent-revoked')
    expect(repo.saveConsent).toHaveBeenCalledWith(expect.objectContaining({ status: 'revoked', encryptedAccessToken: undefined, cursor: undefined }))
    expect(scheduleSyncOnce).not.toHaveBeenCalled()
  })
})
