import { afterEach, describe, expect, it, vi } from 'vitest'
import { CloudStateConflictError, fetchCloudState, saveCloudState } from './cloudState'
import type { VaultPayload } from '../../vault'

const payload: VaultPayload = {
  state: {
    accounts: [{ id: 'account-1', name: 'Girokonto', type: 'checking', balanceCents: 10000, currency: 'EUR' }],
    transactions: [],
    goals: [],
  },
  secureData: { 'behavior-graph-v1': [] },
}

afterEach(() => vi.unstubAllGlobals())

describe('cloud state API', () => {
  it('loads a validated authenticated state document', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ payload, version: 3, updatedAt: '2026-07-31T10:00:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchCloudState()).resolves.toEqual({ payload, version: 3, updatedAt: '2026-07-31T10:00:00.000Z' })
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/state', expect.objectContaining({ credentials: 'include', cache: 'no-store' }))
  })

  it('sends the complete vault payload and expected version', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ payload, expectedVersion: 4 })
      return new Response(JSON.stringify({ version: 5, updatedAt: '2026-07-31T10:01:00.000Z' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(saveCloudState(payload, 4)).resolves.toEqual({ version: 5, updatedAt: '2026-07-31T10:01:00.000Z' })
  })

  it('surfaces optimistic concurrency conflicts without overwriting either device', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ currentVersion: 8, error: { code: 'cloud_state_conflict', message: 'conflict' } }), { status: 409, headers: { 'Content-Type': 'application/json' } })))

    try {
      await saveCloudState(payload, 7)
      throw new Error('Expected a cloud-state conflict.')
    } catch (error) {
      expect(error).toBeInstanceOf(CloudStateConflictError)
      expect((error as CloudStateConflictError).currentVersion).toBe(8)
    }
  })
})
