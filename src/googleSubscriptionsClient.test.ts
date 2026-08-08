import { afterEach, describe, expect, it, vi } from 'vitest'
import { disconnectGoogleSubscriptions, getGoogleSubscriptionCapability, syncGoogleSubscriptions } from './googleSubscriptions'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('Google subscription client API', () => {
  it('loads Gmail capability without exposing credentials', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      enabled: true,
      source: 'gmail',
      configured: true,
      ready: true,
      connected: false,
      requiredScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      limitations: ['Receipt-derived and incomplete.'],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await getGoogleSubscriptionCapability()
    expect(result).toMatchObject({ source: 'gmail', ready: true, connected: false })
    expect(result.requiredScopes).toContain('https://www.googleapis.com/auth/gmail.readonly')
    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions/google/capability', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
  })

  it('returns source-labelled synchronized subscriptions and limitations', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      connected: true,
      source: 'gmail',
      lastSyncAt: '2026-08-04T18:00:00.000Z',
      limitations: ['Not a complete Google Play list.'],
      subscriptions: [{ externalId: 'gmail:one', provider: 'Google Play (Gmail-Beleg)', product: 'Google One', amountCents: 199, currency: 'EUR', billingInterval: 'monthly', status: 'active' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch

    const result = await syncGoogleSubscriptions()
    expect(result.source).toBe('gmail')
    expect(result.subscriptions).toHaveLength(1)
    expect(result.limitations?.[0]).toMatch(/complete/)
  })

  it('passes the imported-data deletion choice explicitly on disconnect', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      disconnected: true,
      revoked: true,
      deletedImportedData: true,
      deletedSubscriptionCount: 2,
      cloudStateUpdated: true,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await disconnectGoogleSubscriptions(true)
    expect(result.deletedSubscriptionCount).toBe(2)
    expect(fetchMock).toHaveBeenCalledWith('/api/subscriptions/google', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ deleteImportedData: true }),
    }))
  })
})
