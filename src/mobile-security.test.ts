import { describe, expect, it } from 'vitest'
import { isAllowedAppUrl, shouldLockAfterBackground } from './mobile-security'

describe('mobile session security', () => {
  it('locks after the background grace period', () => {
    expect(shouldLockAfterBackground(1_000, 30_999)).toBe(false)
    expect(shouldLockAfterBackground(1_000, 31_000)).toBe(true)
  })

  it('fails closed for invalid timing input', () => {
    expect(shouldLockAfterBackground(Number.NaN, 100)).toBe(true)
    expect(shouldLockAfterBackground(100, Number.NaN)).toBe(true)
  })

  it('only accepts same-origin application routes', () => {
    const origin = 'https://finance.example'
    expect(isAllowedAppUrl('/transactions', origin)).toBe(true)
    expect(isAllowedAppUrl('https://finance.example/budgets?month=7', origin)).toBe(true)
    expect(isAllowedAppUrl('https://evil.example/transactions', origin)).toBe(false)
    expect(isAllowedAppUrl('javascript:alert(1)', origin)).toBe(false)
    expect(isAllowedAppUrl('/api/accounts', origin)).toBe(false)
    expect(isAllowedAppUrl('/oauth/callback', origin)).toBe(false)
    expect(isAllowedAppUrl('/connectors/bank', origin)).toBe(false)
  })
})
