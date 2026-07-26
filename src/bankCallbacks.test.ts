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
  async consumeNonce(input: { nonce: string; expiresAt: number; now: number }) {
    if (input.expiresAt <= input.now || this.consumed.has(input.nonce)) return false
    this.consumed.add(input.nonce)
    return true
  }
}

class MemoryWebhookRepository implements BankWebhookLeaseRepository {
  claimed = new Set<string>()
  completed = new Set<string>()
  async claimWebhookEvent(input: { eventId: string }) {
    if (this.claimed.has(input.eventId) || this.completed.has(input.eventId)) return false
    this.claimed.add(input.eventId)
    return true
  }
  async completeWebhookEvent(input: { eventId: string }) {
    this.claimed.delete(input.eventId)
    this.completed.add(input.eventId)
  }
  async releaseWebhookEvent(input: { eventId: string }) { this.claimed.delete(input.eventId) }
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

describe('bank callback hardening', () => {
  it('consumes the OAuth nonce exactly once before connecting', async () => {
    const repository = new MemoryRepository()
    const nonces = new MemoryNonceRepository()
    const adapter = provider()
    const secret = new Uint8Array(32).fill(7)
    const now = new Date('2026-07-26T12:00:00.000Z')
    await repository.saveConsent(consent)
    await beginBankConnection({ consent, state: 'placeholder', redirectUri: 'https://app.test/callback', provider: adapter, repository, now })
    const state = await issueOAuthState({
      userId: 'user-1', provider: 'sandbox', redirectUri: 'https://app.test/callback',
      nonce: 'nonce-1', expiresAt: now.getTime() + 60_000,
    }, secret)

    await expect(completeBankCallback({
      state, stateSecret: secret,
      expected: { userId: 'user-1', provider: 'sandbox', redirectUri: 'https://app.test/callback' },
      nonceRepository: nonces, consentId: consent.id, provider: adapter, repository, vault: vault(), now,
    })).resolves.toMatchObject({ status: 'active' })

    await expect(completeBankCallback({
      state, stateSecret: secret,
      expected: { userId: 'user-1', provider: 'sandbox', redirectUri: 'https://app.test/callback' },
      nonceRepository: nonces, consentId: consent.id, provider: adapter, repository, vault: vault(), now,
    })).rejects.toThrow('already used or expired')
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

  it('releases the lease after handler failure so delivery can retry', async () => {
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
