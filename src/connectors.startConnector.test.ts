// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startConnector } from './connectors'

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
}

// Every test above this point relies on jsdom's real default behavior for
// window.open() (unimplemented -- always returns null), which happens to
// exercise exactly the "popup blocked" fallback path. This mocks a
// successful popup instead, to cover the (far more common in a real
// browser) case none of those tests do: the popup actually opens.
function fakePopup() {
  const replace = vi.fn()
  const close = vi.fn()
  const popup = {
    location: { replace },
    close,
    document: { title: '', body: { textContent: '' } },
  } as unknown as Window
  return { popup, replace, close }
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

  describe('when the browser allows a popup', () => {
    it('returns { mode: "popup" } and never navigates the current tab -- only the popup is redirected', async () => {
      const { popup, replace } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      mockFetchOnce({ redirectUrl: 'https://auth.enablebanking.com/ais/auth-1' })

      const result = await startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })

      expect(assignSpy).not.toHaveBeenCalled()
      expect(result.mode).toBe('popup')
      if (result.mode === 'popup') {
        expect(result.attempt.popup).toBe(popup)
        expect(result.attempt.provider).toBe('enablebanking')
      }
      expect(replace).toHaveBeenCalledWith('https://auth.enablebanking.com/ais/auth-1')
    })

    it('this is true for every provider, not just Enable Banking -- the popup mechanism is provider-agnostic', async () => {
      const { popup, replace } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      mockFetchOnce({ redirectUrl: 'https://ob.gocardless.com/psd2/start/req-1' })

      const result = await startConnector('gocardless', {})

      expect(result.mode).toBe('popup')
      expect(replace).toHaveBeenCalledWith('https://ob.gocardless.com/psd2/start/req-1')
      expect(assignSpy).not.toHaveBeenCalled()
    })

    it('the /start request body carries the popup-specific return URL (bound to this attempt), never the plain application page URL', async () => {
      const { popup } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ redirectUrl: 'https://auth.enablebanking.com/ais/auth-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      vi.stubGlobal('fetch', fetchMock)

      await startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String(init?.body))
      expect(String(body.redirectUri)).toContain('fp_connection_attempt=')
    })

    it('a failed /start abandons (closes) the already-open popup and its pending attempt binding, rather than leaving it dangling', async () => {
      const { popup, close } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'boom' } }), { status: 500, headers: { 'Content-Type': 'application/json' } })))

      await expect(startConnector('enablebanking', { institutionId: 'DE:ING-DiBa' })).rejects.toThrow()

      expect(close).toHaveBeenCalled()
    })
  })

  describe('when the browser blocks the popup', () => {
    it('falls through to the same-tab/embedded-widget path instead of rejecting the whole attempt -- the fallback documented in code is actually reachable', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null)
      mockFetchOnce({ redirectUrl: 'https://ob.gocardless.com/psd2/start/req-1' })

      const result = await startConnector('gocardless', {})

      expect(result).toEqual({ mode: 'redirect' })
      expect(assignSpy).toHaveBeenCalledWith('https://ob.gocardless.com/psd2/start/req-1')
    })

    it('a browser that blocks storage (sessionStorage throws) falls back the same way, never hard-failing the connection attempt', async () => {
      const { popup } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled') })
      mockFetchOnce({ redirectUrl: 'https://ob.gocardless.com/psd2/start/req-1' })

      const result = await startConnector('gocardless', {})

      expect(result).toEqual({ mode: 'redirect' })
      expect(assignSpy).toHaveBeenCalledWith('https://ob.gocardless.com/psd2/start/req-1')
    })
  })
})
