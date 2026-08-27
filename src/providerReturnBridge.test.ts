// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abandonConnectorPopupAttempt,
  acceptConnectorReturnSignal,
  beginConnectorPopupAttempt,
  clearPendingConnectorAttempt,
  navigateConnectorPopup,
  publishConnectorReturnFromPopup,
  subscribeConnectorReturns,
  takeBufferedConnectorReturn,
  type ConnectorReturnSignal,
} from './providerReturnBridge'

const PENDING_STORAGE_KEY = 'finance-planner-connector-pending-v1'
const RETURN_STORAGE_PREFIX = 'finance-planner-connector-return-v1:'
const POPUP_ORIGIN_MARKER_KEY = 'finance-planner-connector-popup-origin-v1'

// Simulates what a REAL popup's own sessionStorage would contain on return:
// beginConnectorPopupAttempt() writes this marker immediately before
// window.open() (picked up by the new browsing context's one-time
// sessionStorage clone) and removes it from the opener right after -- a
// unit test has no real second browsing context to clone into, so this
// stands in for "the document currently running this test is that popup".
function markAsPopupReturn(attemptId: string) {
  sessionStorage.setItem(POPUP_ORIGIN_MARKER_KEY, attemptId)
}

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

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, document.title, '/')
  document.body.innerHTML = '<div id="root"></div>'
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState({}, document.title, '/')
})

describe('provider return bridge', () => {
  it('opens the provider in a separate window and binds the attempt to this tab before navigation', () => {
    const { popup, replace } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)

    const attempt = beginConnectorPopupAttempt('enablebanking')
    const pending = JSON.parse(sessionStorage.getItem(PENDING_STORAGE_KEY) || '{}')

    expect(attempt.provider).toBe('enablebanking')
    expect(pending.attemptId).toBe(attempt.attemptId)
    expect(pending.provider).toBe('enablebanking')
    expect(typeof pending.createdAt).toBe('number')

    navigateConnectorPopup(attempt, 'https://auth.enablebanking.com/ais/test')
    expect(replace).toHaveBeenCalledWith('https://auth.enablebanking.com/ais/test')
  })

  it('fails before provider start when a browser blocks the authorization window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)

    expect(() => beginConnectorPopupAttempt('enablebanking')).toThrow(/Allow pop-ups/)
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })

  it('rejects a return that does not match the tab-local attempt or provider', () => {
    const { popup } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const attempt = beginConnectorPopupAttempt('enablebanking')

    const wrongAttempt: ConnectorReturnSignal = {
      type: 'finance-planner:connector-return',
      attemptId: 'aaaaaaaaaaaaaaaa',
      provider: 'enablebanking',
    }
    expect(acceptConnectorReturnSignal(wrongAttempt)).toBeNull()

    const wrongProvider: ConnectorReturnSignal = {
      type: 'finance-planner:connector-return',
      attemptId: attempt.attemptId,
      provider: 'gocardless',
    }
    expect(acceptConnectorReturnSignal(wrongProvider)).toBeNull()
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).not.toBeNull()
  })

  it('publishes only bounded return metadata, never callback code/state/free-text detail', () => {
    vi.useFakeTimers()
    const attemptId = '1234567890abcdef1234567890abcdef'
    window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=enablebanking&code=secret-code&state=secret-state&error_description=secret-detail`)
    markAsPopupReturn(attemptId)

    expect(publishConnectorReturnFromPopup()).toBe(true)
    const raw = localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attemptId}`)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw || '{}')).toEqual({
      type: 'finance-planner:connector-return',
      attemptId,
      provider: 'enablebanking',
    })
    expect(raw).not.toContain('secret-code')
    expect(raw).not.toContain('secret-state')
    expect(raw).not.toContain('secret-detail')
    expect(document.getElementById('root')).toHaveTextContent('Bank authorization completed')
  })

  it('accepts a buffered matching return once and clears both bridge records', () => {
    const { popup } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const attempt = beginConnectorPopupAttempt('enablebanking')
    const signal: ConnectorReturnSignal = {
      type: 'finance-planner:connector-return',
      attemptId: attempt.attemptId,
      provider: 'enablebanking',
    }
    localStorage.setItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`, JSON.stringify(signal))

    expect(takeBufferedConnectorReturn()).toEqual(signal)
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`)).toBeNull()
    expect(takeBufferedConnectorReturn()).toBeNull()
  })

  it('an expired pending attempt (older than the 20-minute bound) is never accepted, even with a matching signal', () => {
    const attemptId = 'b'.repeat(20)
    sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ attemptId, provider: 'enablebanking', createdAt: Date.now() - 21 * 60 * 1000 }))
    localStorage.setItem(`${RETURN_STORAGE_PREFIX}${attemptId}`, JSON.stringify({ type: 'finance-planner:connector-return', attemptId, provider: 'enablebanking' }))

    expect(takeBufferedConnectorReturn()).toBeNull()
    // The expired attempt's own return record is cleaned up too, not just ignored.
    expect(localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attemptId}`)).toBeNull()
  })

  it('a signal already consumed once cannot be replayed -- the pending record is gone, so a second delivery of the same signal is rejected', () => {
    const { popup } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const attempt = beginConnectorPopupAttempt('enablebanking')
    const signal: ConnectorReturnSignal = { type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider: 'enablebanking' }

    expect(acceptConnectorReturnSignal(signal)).toEqual(signal)
    // A replay of the exact same signal (e.g. a duplicate BroadcastChannel
    // delivery, or a second tab's storage event) must not be accepted twice.
    expect(acceptConnectorReturnSignal(signal)).toBeNull()
  })

  it('abandoning a popup attempt closes the real window and removes both the pending binding and any buffered return', () => {
    const { popup, close } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const attempt = beginConnectorPopupAttempt('enablebanking')
    localStorage.setItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`, JSON.stringify({ type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider: 'enablebanking' }))

    abandonConnectorPopupAttempt(attempt)

    expect(close).toHaveBeenCalled()
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`)).toBeNull()
  })

  it('clearPendingConnectorAttempt (logout) removes both the pending binding and any already-buffered return for it, not just the binding', () => {
    const { popup } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const attempt = beginConnectorPopupAttempt('enablebanking')
    localStorage.setItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`, JSON.stringify({ type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider: 'enablebanking' }))

    clearPendingConnectorAttempt()

    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attempt.attemptId}`)).toBeNull()
    expect(acceptConnectorReturnSignal({ type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider: 'enablebanking' })).toBeNull()
  })

  it('clearPendingConnectorAttempt is a no-op when there is no pending attempt, and never throws', () => {
    expect(() => clearPendingConnectorAttempt()).not.toThrow()
    expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull()
  })

  it('clearPendingConnectorAttempt never throws even when storage access fails (logout must always complete)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage disabled') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage disabled') })
    expect(() => clearPendingConnectorAttempt()).not.toThrow()
  })

  it('delivers a matching return via BroadcastChannel to a subscriber, with the payload intact', async () => {
    const { popup } = fakePopup()
    vi.spyOn(window, 'open').mockReturnValue(popup)
    const attempt = beginConnectorPopupAttempt('enablebanking')

    // BroadcastChannel delivery is asynchronous even within the same
    // document -- wait for the subscriber's own callback to actually fire
    // rather than asserting synchronously right after postMessage.
    const delivered = new Promise<ConnectorReturnSignal>((resolve) => {
      const unsubscribe = subscribeConnectorReturns((signal) => { unsubscribe(); resolve(signal) })
    })

    const channel = new BroadcastChannel('finance-planner-connector-return-v1')
    channel.postMessage({ type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider: 'enablebanking' })
    channel.close()

    await expect(delivered).resolves.toEqual({ type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider: 'enablebanking' })
  })

  it('never delivers a malformed BroadcastChannel payload (wrong type, missing attemptId, or carrying neither provider nor error) to a subscriber', async () => {
    const received: unknown[] = []
    const unsubscribe = subscribeConnectorReturns((signal) => { received.push(signal) })
    const channel = new BroadcastChannel('finance-planner-connector-return-v1')

    for (const malformed of [
      { type: 'wrong-type', attemptId: 'a'.repeat(20), provider: 'enablebanking' },
      { type: 'finance-planner:connector-return', attemptId: 'too-short', provider: 'enablebanking' },
      { type: 'finance-planner:connector-return', attemptId: 'a'.repeat(20) },
    ]) {
      channel.postMessage(malformed)
    }
    // Let any (incorrectly) scheduled delivery have a chance to run before asserting nothing arrived.
    await new Promise((resolve) => window.setTimeout(resolve, 20))

    channel.close()
    unsubscribe()
    expect(received).toEqual([])
  })

  // Fixed 2026-08-25 (review on PR #154): parseSignal() previously accepted
  // any non-empty provider/error string, so the "only bounded callback
  // metadata crosses this boundary" claim above wasn't actually enforced.
  // provider must be one of Finance Planner's own known connector ids;
  // error must look like a short machine error code, never free text, an
  // oversized value, or anything URL/HTML-shaped.
  describe('bounded provider/error validation', () => {
    it('accepts each of the four known connector providers', () => {
      const { popup } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      for (const provider of ['enablebanking', 'gocardless', 'finapi', 'paypal']) {
        sessionStorage.clear()
        const attempt = beginConnectorPopupAttempt(provider)
        const signal: ConnectorReturnSignal = { type: 'finance-planner:connector-return', attemptId: attempt.attemptId, provider }
        expect(acceptConnectorReturnSignal(signal)).toEqual(signal)
      }
    })

    it('rejects an unknown provider name from the URL, publishing nothing', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=not-a-real-provider`)
      markAsPopupReturn(attemptId)
      expect(publishConnectorReturnFromPopup()).toBe(false)
      expect(localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attemptId}`)).toBeNull()
    })

    it('rejects a provider value containing free text/spaces', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=${encodeURIComponent('enable banking please')}`)
      markAsPopupReturn(attemptId)
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })

    it('rejects an oversized provider value', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=${'enablebanking'.repeat(20)}`)
      markAsPopupReturn(attemptId)
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })

    it('accepts an ordinary OAuth-style machine error code', () => {
      const { popup } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      const attempt = beginConnectorPopupAttempt('enablebanking')
      const signal: ConnectorReturnSignal = { type: 'finance-planner:connector-return', attemptId: attempt.attemptId, error: 'access_denied' }
      expect(acceptConnectorReturnSignal(signal)).toEqual(signal)
    })

    it('rejects an error value containing spaces/free text', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&error=${encodeURIComponent('the user said no thanks')}`)
      markAsPopupReturn(attemptId)
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })

    it('rejects an oversized error value', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&error=${'a'.repeat(65)}`)
      markAsPopupReturn(attemptId)
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })

    it('never delivers code/state/error_description through BroadcastChannel, only the bounded provider metadata', async () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=enablebanking&code=secret-code&state=secret-state&error_description=secret-detail`)
      markAsPopupReturn(attemptId)

      const delivered = new Promise<ConnectorReturnSignal>((resolve) => {
        const unsubscribe = subscribeConnectorReturns((signal) => { unsubscribe(); resolve(signal) })
      })

      expect(publishConnectorReturnFromPopup()).toBe(true)

      const signal = await delivered
      expect(signal).toEqual({ type: 'finance-planner:connector-return', attemptId, provider: 'enablebanking' })
      expect(JSON.stringify(signal)).not.toMatch(/secret-code|secret-state|secret-detail/)
    })
  })

  // Fixed 2026-08-25 (PR #154 review): publishConnectorReturnFromPopup()
  // used to treat ANY document carrying a syntactically valid
  // fp_connection_attempt + provider/error as the popup transport surface --
  // including an ordinary tab that merely navigated to a crafted
  // same-origin URL. It now also requires this document's own sessionStorage
  // to carry POPUP_ORIGIN_MARKER_KEY matching the URL's attemptId, which
  // only the real popup Finance Planner opened for that exact attempt ever
  // has (see beginConnectorPopupAttempt()'s sessionStorage-clone-at-creation
  // note).
  describe('popup-context binding (bootstrap short-circuit is popup-bound, not URL-triggered)', () => {
    it('a crafted URL with a perfectly valid attemptId/provider does NOT short-circuit in a document with no popup-origin marker at all', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=enablebanking`)
      // Deliberately no markAsPopupReturn() call -- this simulates an
      // ordinary tab (including the user's own already-open Finance Planner
      // tab, which never receives this marker either) that merely loaded a
      // URL shaped like a popup return.
      expect(publishConnectorReturnFromPopup()).toBe(false)
      expect(localStorage.getItem(`${RETURN_STORAGE_PREFIX}${attemptId}`)).toBeNull()
      expect(document.getElementById('root')).not.toHaveTextContent('Bank authorization completed')
    })

    it('beginConnectorPopupAttempt() removes the marker from the OPENER immediately after creating the popup, so the opener itself is never mistaken for the popup', () => {
      const { popup } = fakePopup()
      vi.spyOn(window, 'open').mockReturnValue(popup)
      const attempt = beginConnectorPopupAttempt('enablebanking')

      // If the opener's own tab later loaded a URL carrying this same
      // attemptId (e.g. the user pasted/bookmarked it, or it leaked into
      // browser history), it must not be treated as the popup returning --
      // the marker was already consumed/removed from this context.
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attempt.attemptId}&provider=enablebanking`)
      expect(sessionStorage.getItem(POPUP_ORIGIN_MARKER_KEY)).toBeNull()
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })

    it('a marker present for a DIFFERENT attemptId than the URL does not match', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      const otherAttemptId = 'fedcba0987654321fedcba0987654321'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=enablebanking`)
      markAsPopupReturn(otherAttemptId)
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })

    it('the marker is single-use -- a second load of the same popup-return URL after a successful publish does not re-trigger it', () => {
      const attemptId = '1234567890abcdef1234567890abcdef'
      window.history.replaceState({}, document.title, `/?fp_connection_attempt=${attemptId}&provider=enablebanking`)
      markAsPopupReturn(attemptId)

      expect(publishConnectorReturnFromPopup()).toBe(true)
      expect(sessionStorage.getItem(POPUP_ORIGIN_MARKER_KEY)).toBeNull()
      // Simulate the same document loading the same URL again (e.g. a
      // reload before window.close() actually takes effect) -- the marker
      // is already gone, so this must not publish a second time.
      expect(publishConnectorReturnFromPopup()).toBe(false)
    })
  })
})
