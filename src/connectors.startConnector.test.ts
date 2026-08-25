// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startConnector } from './connectors'

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })))
}

// jsdom's window.open() is unimplemented and always returns null, which
// exercises the real "popup blocked" path by default. This mocks a
// successful popup instead, for the tests that need to cover the case a
// default jsdom environment can't: the popup actually opens.
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
    sessionStorage.clear()
    localStorage.clear()
  })

  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  // These test the embedded-auth/same-tab-redirect response-shape handling
  // in startConnector(). In production that code is unreachable: a real
  // popup either opens (mode: 'popup', tested below) or fails closed before
  // /start is ever called (also tested below) -- it never falls through to
  // here. This branch survives only for VITE_ACCEPTANCE_FIXTURES=true, which
  // deliberately skips real popup creation for deterministic test/demo
  // fixtures, so that is the mode these tests exercise.
  describe('in acceptance-fixture mode (embedded-auth/redirect response shapes)', () => {
    beforeEach(() => vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true'))

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

  // Production invariant (fixed 2026-08-25, review on PR #154): a blocked
  // popup or an unavailable tab-local return binding must fail CLOSED --
  // never fall through to a same-tab redirect or the embedded widget. Either
  // fallback would unload this document and destroy the memory-only vault
  // key, recreating the exact "forced re-unlock on provider return"
  // regression this PR exists to fix. So in both cases below: startConnector
  // rejects, /api/connectors/{provider}/start is never called (no server
  // provider-authorization nonce is created), the current tab is never
  // navigated, and no pending attempt is left behind for a later return to
  // match against.
  describe('when the browser blocks the popup', () => {
    it('A. popup blocked: rejects before contacting /start, never navigates, and starts no pending authorization', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      vi.spyOn(window, 'open').mockReturnValue(null)

      await expect(startConnector('gocardless', {})).rejects.toThrow(/secure window/i)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(assignSpy).not.toHaveBeenCalled()
      expect(sessionStorage.getItem('finance-planner-connector-pending-v1')).toBeNull()
    })

    it('B. sessionStorage unavailable: rejects, closes the opened popup, never contacts /start, never navigates', async () => {
      const { popup, close } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage disabled') })
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(startConnector('gocardless', {})).rejects.toThrow(/secure return binding/i)

      expect(close).toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
      expect(assignSpy).not.toHaveBeenCalled()
    })
  })
})
