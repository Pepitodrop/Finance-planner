import { describe, expect, it } from 'vitest'
import {
  AesGcmTokenVault,
  acceptWebhookOnce,
  beginBankConnection,
  connectBank,
  disconnectBank,
  issueOAuthState,
  syncBankConnection,
  verifyOAuthState,
  type BankConsent,
  type BankProviderAdapter,
  type BankRuntimeRepository,
  type ProviderTransaction,
} from './bankRuntime'

class MemoryRepository implements BankRuntimeRepository {
  consents = new Map<string, BankConsent>()
  events = new Set<string>()
  transactions = new Map<string, ProviderTransaction>()
  async getConsent(id: string) { return this.consents.get(id) }
  async saveConsent(consent: BankConsent) { this.consents.set(consent.id, consent) }
  async hasWebhookEvent(eventId: string) { return this.events.has(eventId) }
  async commitWebhookEvent(eventId: string) {
    if (this.events.has(eventId)) return false
    this.events.add(eventId)
    return true
  }
  async commitSyncPage(input: {
    consentId: string
    expectedCursor?: string
    nextCursor?: string
    completed: boolean
    transactions: ProviderTransaction[]
  }) {
    const consent = this.consents.get(input.consentId)
    if (!consent || consent.cursor !== input.expectedCursor) throw new Error('Concurrent cursor update.')
    for (const transaction of input.transactions) this.transactions.set(transaction.id, transaction)
    this.consents.set(input.consentId, { ...consent, cursor: input.nextCursor })
  }
}

function provider(pages: Awaited<ReturnType<BankProviderAdapter['fetchTransactions']>>[], calls = { refresh: 0 }): BankProviderAdapter {
  return {
    name: 'sandbox',
    async createAuthorization({ state }) {
      return { authorizationUrl: `https://bank.test/start?state=${state}`, connectionId: 'req-1' }
    },
    async completeAuthorization() {
      return {
        accessToken: 'access-secret', refreshToken: 'refresh-secret',
        accessTokenExpiresAt: '2026-07-26T12:30:00.000Z',
        consentExpiresAt: '2026-10-24T12:00:00.000Z', accountIds: ['account-1'],
      }
    },
    async refreshTokens() {
      calls.refresh += 1
      return { accessToken: 'new-access-secret', accessTokenExpiresAt: '2026-07-27T12:00:00.000Z' }
    },
    async revoke() {},
    async fetchTransactions() {
      const page = pages.shift()
      if (!page) throw new Error('Unexpected page request.')
      return page
    },
  }
}

const consent: BankConsent = {
  id: 'consent-1', userId: 'user-1', provider: 'sandbox', status: 'pending',
  expiresAt: '2026-10-24T12:00:00.000Z', updatedAt: '2026-07-26T12:00:00.000Z',
}
function vault() {
  return new AesGcmTokenVault({ id: 'key-2', rawKey: new Uint8Array(32).fill(2) }, [
    { id: 'key-1', rawKey: new Uint8Array(32).fill(1) },
  ])
}

async function connected(repository: MemoryRepository, adapter: BankProviderAdapter, now = new Date('2026-07-26T12:00:00.000Z')) {
  await repository.saveConsent(consent)
  await beginBankConnection({ consent, state: 'signed-state', redirectUri: 'https://app.test/callback', provider: adapter, repository, now })
  return connectBank({ consentId: consent.id, provider: adapter, repository, vault: vault(), now })
}

describe('OAuth state', () => {
  it('binds state to user, provider and redirect URI', async () => {
    const secret = new Uint8Array(32).fill(7)
    const claims = { userId: 'user-1', provider: 'sandbox', redirectUri: 'https://app.test/callback', nonce: 'nonce-1', expiresAt: Date.now() + 60_000 }
    const state = await issueOAuthState(claims, secret)
    await expect(verifyOAuthState(state, secret, { userId: 'user-1', provider: 'sandbox', redirectUri: 'https://app.test/callback' })).resolves.toEqual(claims)
    await expect(verifyOAuthState(state, secret, { userId: 'user-2', provider: 'sandbox', redirectUri: 'https://app.test/callback' })).rejects.toThrow('binding mismatch')
  })
})

describe('token vault', () => {
  it('encrypts tokens and rotates old ciphertext', async () => {
    const oldVault = new AesGcmTokenVault({ id: 'key-1', rawKey: new Uint8Array(32).fill(1) })
    const encrypted = await oldVault.encrypt('provider-token')
    expect(encrypted.ciphertext).not.toContain('provider-token')
    const rotated = await vault().rotate(encrypted)
    expect(rotated.keyId).toBe('key-2')
    await expect(vault().decrypt(rotated)).resolves.toBe('provider-token')
  })
})

describe('bank lifecycle', () => {
  it('creates an authorization session, connects, persists sync checkpoint and disconnects', async () => {
    const repository = new MemoryRepository()
    const adapter = provider([{
      transactions: [{ id: 't1', bookedAt: '2026-07-01', amountCents: -500, currency: 'EUR', description: 'Coffee' }],
      nextCursor: '2026-07-01', completed: true,
    }])
    const result = await connected(repository, adapter)
    expect(result).toMatchObject({ status: 'active', providerConnectionId: 'req-1', accountIds: ['account-1'] })
    expect(result.encryptedAccessToken?.ciphertext).not.toContain('access-secret')
    await expect(syncBankConnection({ consentId: consent.id, provider: adapter, repository, vault: vault(), now: new Date('2026-07-26T12:10:00.000Z') }))
      .resolves.toEqual({ imported: 1, pages: 1, completed: true })
    expect(repository.consents.get(consent.id)?.cursor).toBe('2026-07-01')
    await disconnectBank({ consentId: consent.id, provider: adapter, repository, vault: vault() })
    expect(repository.consents.get(consent.id)).toMatchObject({ status: 'revoked', encryptedAccessToken: undefined })
  })

  it('refreshes an expired provider token without expiring the bank consent', async () => {
    const repository = new MemoryRepository()
    const calls = { refresh: 0 }
    const adapter = provider([{ transactions: [], nextCursor: '2026-07-01', completed: true }], calls)
    await connected(repository, adapter)
    await syncBankConnection({ consentId: consent.id, provider: adapter, repository, vault: vault(), now: new Date('2026-07-26T13:00:00.000Z') })
    expect(calls.refresh).toBe(1)
    expect(repository.consents.get(consent.id)).toMatchObject({ status: 'active', tokenExpiresAt: '2026-07-27T12:00:00.000Z' })
  })

  it('rejects a reconciliation mismatch before committing', async () => {
    const repository = new MemoryRepository()
    const adapter = provider([{
      transactions: [{ id: 't1', bookedAt: '2026-07-01', amountCents: -500, currency: 'EUR', description: 'Coffee' }],
      openingBalanceCents: 10_000, closingBalanceCents: 9_000, completed: true,
    }])
    await connected(repository, adapter)
    await expect(syncBankConnection({ consentId: consent.id, provider: adapter, repository, vault: vault(), now: new Date('2026-07-26T12:10:00.000Z') }))
      .rejects.toThrow('reconciliation failed')
    expect(repository.transactions.size).toBe(0)
  })
})

describe('webhook idempotency', () => {
  it('accepts a signed event exactly once', async () => {
    const repository = new MemoryRepository()
    const now = Date.parse('2026-07-26T12:00:00.000Z')
    const event = { id: 'evt-1', occurredAt: '2026-07-26T11:59:00.000Z', signatureValid: true }
    await expect(acceptWebhookOnce(repository, event, now)).resolves.toBe(true)
    await expect(acceptWebhookOnce(repository, event, now)).resolves.toBe(false)
  })
})
