import { describe, expect, it, vi } from 'vitest'
import { recurringPayments } from './finance'
import { resolveMerchantLogo } from './merchant-logos'
import { probeSameOrigin } from './mobile-connectivity'
import type { Transaction } from './types'

describe('public connectivity probe', () => {
  it('uses the public health/live endpoint', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('/health/live?connectivity-check=')
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }) as typeof fetch

    await expect(probeSameOrigin(fetcher, 'https://finance.example')).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})

describe('merchant logo matching', () => {
  it('matches known merchant variants locally', () => {
    expect(resolveMerchantLogo('REWE Markt 1234')?.slug).toBe('rewe')
    expect(resolveMerchantLogo('EDEKA Südwest 4711')?.slug).toBe('edeka')
    expect(resolveMerchantLogo('Spotify AB Stockholm')?.slug).toBe('spotify')
    expect(resolveMerchantLogo('Unbekannter Laden')).toBeNull()
  })
})

describe('recurring series grouping', () => {
  it('collapses historical occurrences into one monthly series', () => {
    const transactions: Transaction[] = [
      { id: '1', accountId: 'a', description: 'Netflix', category: 'Abonnements', type: 'expense', amountCents: 1799, date: '2026-06-17', recurring: true },
      { id: '2', accountId: 'a', description: 'Netflix', category: 'Abonnements', type: 'expense', amountCents: 1799, date: '2026-07-17', recurring: true },
      { id: '3', accountId: 'a', description: 'Netflix', category: 'Abonnements', type: 'expense', amountCents: 1799, date: '2026-08-17', recurring: true },
    ]

    const series = recurringPayments(transactions)
    expect(series).toHaveLength(1)
    expect(series[0]).toMatchObject({ description: 'Netflix', occurrenceCount: 3, amountCents: 1799, lastDate: '2026-08-17' })
  })
})
