// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startConnector } from './connectors'

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
}

describe('startConnector', () => {
  let assignSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    assignSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign: assignSpy, href: 'https://finance.example.com/connections' }, writable: true })
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('1. does not navigate away for Enable Banking when a valid embedded-auth descriptor is present, and returns it to the caller', async () => {
    mockFetchOnce({ redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authFlow: { provider: 'enablebanking', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: true } })
    const result = await startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })
    expect(assignSpy).not.toHaveBeenCalled()
    expect(result).toEqual({ mode: 'embedded-auth', provider: 'enablebanking', redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authorizationId: 'auth-1', origin: 'https://auth.enablebanking.com', sandbox: true })
  })

  it('2a. GoCardless still redirects immediately, exactly as before', async () => {
    mockFetchOnce({ redirectUrl: 'https://ob.gocardless.com/psd2/start/req-1' })
    const result = await startConnector('gocardless', { institutionId: 'ING_INGDDEFF' })
    expect(assignSpy).toHaveBeenCalledWith('https://ob.gocardless.com/psd2/start/req-1')
    expect(result).toEqual({ mode: 'redirect' })
  })

  it('2b. PayPal still redirects immediately, exactly as before', async () => {
    mockFetchOnce({ redirectUrl: 'https://www.sandbox.paypal.com/bizsignup/partner/entry?x=1' })
    const result = await startConnector('paypal', {})
    expect(assignSpy).toHaveBeenCalledWith('https://www.sandbox.paypal.com/bizsignup/partner/entry?x=1')
    expect(result).toEqual({ mode: 'redirect' })
  })

  it('an authFlow shape on a non-Enable-Banking provider is ignored -- provider identity must match the call, not just the payload claim', async () => {
    mockFetchOnce({ redirectUrl: 'https://ob.gocardless.com/psd2/start/req-1', authFlow: { provider: 'enablebanking', authorizationId: 'a', origin: 'https://auth.enablebanking.com', sandbox: false } })
    const result = await startConnector('gocardless', {})
    expect(assignSpy).toHaveBeenCalledWith('https://ob.gocardless.com/psd2/start/req-1')
    expect(result).toEqual({ mode: 'redirect' })
  })

  it('Enable Banking redirects immediately when authFlow is entirely absent (server declined to produce one)', async () => {
    mockFetchOnce({ redirectUrl: 'https://auth.enablebanking.com/ais/auth-1' })
    const result = await startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })
    expect(assignSpy).toHaveBeenCalledWith('https://auth.enablebanking.com/ais/auth-1')
    expect(result).toEqual({ mode: 'redirect' })
  })

  it('Enable Banking redirects immediately when authFlow is missing authorizationId -- never half-trusts a broken descriptor', async () => {
    mockFetchOnce({ redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authFlow: { provider: 'enablebanking', origin: 'https://auth.enablebanking.com', sandbox: false } })
    const result = await startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })
    expect(assignSpy).toHaveBeenCalled()
    expect(result).toEqual({ mode: 'redirect' })
  })

  it('Enable Banking redirects immediately when authFlow.origin is not HTTPS', async () => {
    mockFetchOnce({ redirectUrl: 'https://auth.enablebanking.com/ais/auth-1', authFlow: { provider: 'enablebanking', authorizationId: 'a', origin: 'http://auth.enablebanking.com', sandbox: false } })
    const result = await startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })
    expect(assignSpy).toHaveBeenCalled()
    expect(result).toEqual({ mode: 'redirect' })
  })

  it('rejects a non-secure redirectUrl regardless of provider, and never navigates', async () => {
    mockFetchOnce({ redirectUrl: 'http://not-secure.example/x' })
    await expect(startConnector('gocardless', {})).rejects.toThrow(/secure redirect/)
    expect(assignSpy).not.toHaveBeenCalled()
  })
})
