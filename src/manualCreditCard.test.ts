import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeManualCreditCard } from './manualCreditCard'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('manual credit-card normalization', () => {
  it('submits integer cents and accepts an authoritative COBOL result', async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      providerBalanceCents: 12_550,
      creditLimitCents: 50_000,
      pendingAmountCents: 2_000,
      amountOwedCents: 12_550,
      ledgerBalanceCents: -12_550,
      availableCreditCents: 35_450,
      calculationEngine: 'cobol',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await normalizeManualCreditCard({
      providerBalanceCents: 12_550,
      creditLimitCents: 50_000,
      pendingAmountCents: 2_000,
    })

    expect(result).toEqual({
      amountOwedCents: 12_550,
      ledgerBalanceCents: -12_550,
      availableCreditCents: 35_450,
      pendingAmountCents: 2_000,
      calculationEngine: 'cobol',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/finance/normalize-credit-card', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ providerBalanceCents: 12_550, creditLimitCents: 50_000, pendingAmountCents: 2_000 }),
    }))
  })

  it('rejects unsafe inputs before making a request', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as typeof fetch
    await expect(normalizeManualCreditCard({ providerBalanceCents: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow(/cent amount/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a response that is not confirmed by COBOL', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      amountOwedCents: 100,
      ledgerBalanceCents: -100,
      pendingAmountCents: 0,
      calculationEngine: 'javascript',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    await expect(normalizeManualCreditCard({ providerBalanceCents: 100 })).rejects.toThrow(/authoritative COBOL core/)
  })

  it('surfaces server-side failures without falling back locally', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Compiled COBOL banking core is unavailable.' } }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch
    await expect(normalizeManualCreditCard({ providerBalanceCents: 100 })).rejects.toThrow(/COBOL banking core is unavailable/)
  })
})
