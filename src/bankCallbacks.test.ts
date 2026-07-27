import { describe, expect, it } from 'vitest'
import {
  AesGcmTokenVault,
  beginBankConnection,
  issueOAuthState,
  type BankConsent,
  type BankProviderAdapter,
  type BankRuntimeRepository,
  type ProviderTransaction,
} from './bankRuntime'
import {
  completeBankCallback,
  processBankWebhook,
  signBankWebhook,
  type BankWebhookLeaseRepository,
  type ConsentBoundOAuthStateClaims,
  type OAuthNonceRepository,
} from './bankCallbacks'

class MemoryRepository implements BankRuntimeRepository {
  consents = new Map<string, BankConsent>()
  async getConsent(id: string) { return this.consents.get(id) }
  async saveConsent(consent: BankConsent) { this.consents.set(consent.id, consent) }
  async hasWebhookEvent() { return false }
  async commitWebhookEvent() { return true }
  async commitSyncPage(_input: {
    consentId: string
    expectedCursor?: string
    nextCursor?: string
    completed: boolean
    transactions: ProviderTransaction[]
  }) {}
}

class MemoryNonceRepository implements OAuthNonceRepository {
  consumed = new Set<string>()
  async consumeNonce(input: { nonce: string; consentId: string; expiresAt: number; now: number }) {
    const key = `${input.consentId}:${input.nonce}`
    if (input.expiresAt <= input.now || this.consumed.has(key)) return false
    this.consumed.add(key)
    return true
  }
}

class MemoryWebhookRepository implements BankWebhookLeaseRepository {
  leases = new Map<string, string>()
  completed = new Set<string>()
  sequence = 0

  async claimWebhookEvent(input: { eventId: string }) {
    if (this.leases.has(input.eventId) || this.completed.has(input.eventId)) return undefined
    const leaseToken = `lease-${++this.sequence}`
    this.leases.set(input.eventId, leaseToken)
    return leaseToken
  }

  async completeWebhookEvent(input: { eventId: string; leaseToken: string }) {
    if (this.leases.get(input.eventId) !== input.leaseToken) return false
    this.leases.delete(input.eventId)
    this.completed.add(input.eventId)
    return true
  }

  async releaseWebhookEvent(input: { eventId: string; leaseToken: string }) {
    if (this.leases.get(input.eventId) !== input.leaseToken) return false
    this.leases.delete(input.eventId)
    return true
  }
}

const consent: BankConsent = {
  id: 'consent-1', userId: 'user-1', provider: 'sandbox', status: 'pending',
  expiresAt: '2026-10-24T12:00:00.000Z', updatedAt: '2026-07-26T12:00:00.000Z',
}

function provider(): BankProviderAdapter {
  return {
    name: 'sandbox',
    async createAuthorization() { return { authorizationUrl: 'https://bank.test/start', connectionId: 'req-1' } },
    async completeAuthorization() {
      return {
        accessToken: 'access-secret', refreshToken: 'refresh-secret',
        accessTokenExpiresAt: '2026-07-26T13:00:00.000Z',
        consentExpiresAt: '2026-10-24T12:00:00.000Z', accountIds: ['account-1'],
      }
    },
    async refreshTokens() { throw new Error('not used') },
    async revoke() {},
    async fetchTransactions() { return { transactions: [], completed: true } },
  }
}

function vault() {
  return new AesGcmTokenVault({ id: 'key-1', rawKey: new Uint8Array(32).fill(1) })
}

function callbackExpected() {
  return { userId: 'user-1', provider: 'sandbox', redirectUri: 'https://app.test/callback' }
}

async function signedState(secret: Uint8Array, now: Date, consentId = consent.id) {
  const claims: ConsentBoundOAuthStateClaims = {
    ...callbackExpected(), consentId, nonce: 'nonce-1', expiresAt: now.getTime() + 60_000,
  }
  return issueOAuthState(claims, secret)
}

describe('bank callback hardening', () => {
  it('binds the signed state to one exact consent and consumes its nonce once', async () => {
    const repository = new MemoryRepository()
    const nonces = new MemoryNonceRepository()
    const adapter = provider()
    const secret = new Uint8Array(32).fill(7)
    const now = new Date('2026-07-26T12:00:00.000Z')
    await repository.saveConsent(consent)
    await beginBankConnection({ consent, state: 'placeholder', redirectUri: callbackExpected().redirectUri, provider: adapter, repository, now })
    const state = await signedState(secret, now)

    await expect(completeBankCallback({
      state, stateSecret: secret, expected: callbackExpected(), nonceRepository: nonces,
      consentId: consent.id, provider: adapter, repository, vault: vault(), now,
    })).resolves.toMatchObject({ status: 'active' })

    await expect(completeBankCallback({
      state, stateSecret: secret, expected: callbackExpected(), nonceRepository: nonces,
      consentId: consent.id, provider: adapter, repository, vault: vault(), now,
    })).rejects.toThrow('already used or expired')
  })

  it('rejects a valid state when it is presented for a different consent', async () => {
    const repository = new MemoryRepository()
    const nonces = new MemoryNonceRepository()
    const secret = new Uint8Array(32).fill(7)
    const now = new Date('2026-07-26T12:00:00.000Z')
    const otherConsent = { ...consent, id: 'consent-2' }
    await repository.saveConsent(otherConsent)
    await beginBankConnection({ consent: otherConsent, state: 'placeholder', redirectUri: callbackExpected().redirectUri, provider: provider(), repository, now })

    await expect(completeBankCallback({
      state: await signedState(secret, now, consent.id), stateSecret: secret, expected: callbackExpected(),
      nonceRepository: nonces, consentId: otherConsent.id, provider: provider(), repository, vault: vault(), now,
    })).rejects.toThrow('requested bank consent')
  })
})

describe('bank webhook hardening', () => {
  it('verifies signatures and prevents duplicate processing', async () => {
    const repository = new MemoryWebhookRepository()
    const secret = new Uint8Array(32).fill(9)
    const unsigned = { id: 'evt-1', occurredAt: '2026-07-26T11:59:00.000Z', rawBody: '{"type":"transactions.updated"}' }
    const event = { ...unsigned, signature: await signBankWebhook({ event: unsigned, secret }) }
    let calls = 0
    const handler = async () => { calls += 1 }

    await expect(processBankWebhook({ event, secret, repository, handler, now: new Date('2026-07-26T12:00:00.000Z') }))
      .resolves.toBe('processed')
    await expect(processBankWebhook({ event, secret, repository, handler, now: new Date('2026-07-26T12:00:00.000Z') }))
      .resolves.toBe('duplicate')
    expect(calls).toBe(1)
  })

  it('releases the owned lease after handler failure so delivery can retry', async () => {
    const repository = new MemoryWebhookRepository()
    const secret = new Uint8Array(32).fill(9)
    const unsigned = { id: 'evt-2', occurredAt: '2026-07-26T11:59:00.000Z', rawBody: '{}' }
    const event = { ...unsigned, signature: await signBankWebhook({ event: unsigned, secret }) }
    await expect(processBankWebhook({
      event, secret, repository, now: new Date('2026-07-26T12:00:00.000Z'), handler: async () => { throw new Error('temporary') },
    })).rejects.toThrow('temporary')
    await expect(processBankWebhook({
      event, secret, repository, now: new Date('2026-07-26T12:00:00.000Z'), handler: async () => {},
    })).resolves.toBe('processed')
  })

  it('rejects stale lease tokens for completion and release', async () => {
    const repository = new MemoryWebhookRepository()
    const first = await repository.claimWebhookEvent({ eventId: 'evt-fenced', occurredAt: '', leaseUntil: '' })
    expect(first).toBeDefined()
    expect(await repository.releaseWebhookEvent({ eventId: 'evt-fenced', leaseToken: first! })).toBe(true)
    const second = await repository.claimWebhookEvent({ eventId: 'evt-fenced', occurredAt: '', leaseUntil: '' })
    expect(second).not.toBe(first)
    expect(await repository.completeWebhookEvent({ eventId: 'evt-fenced', leaseToken: first!, completedAt: '' })).toBe(false)
    expect(await repository.releaseWebhookEvent({ eventId: 'evt-fenced', leaseToken: first! })).toBe(false)
    expect(repository.leases.get('evt-fenced')).toBe(second)
  })

  it('rejects tampered payloads', async () => {
    const repository = new MemoryWebhookRepository()
    const secret = new Uint8Array(32).fill(9)
    const unsigned = { id: 'evt-3', occurredAt: '2026-07-26T11:59:00.000Z', rawBody: '{}' }
    const signature = await signBankWebhook({ event: unsigned, secret })
    await expect(processBankWebhook({
      event: { ...unsigned, rawBody: '{"tampered":true}', signature }, secret, repository,
      now: new Date('2026-07-26T12:00:00.000Z'), handler: async () => {},
    })).resolves.toBe('rejected')
  })
})
