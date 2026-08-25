import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  acceptConnectorReturnSignal,
  beginConnectorPopupAttempt,
  navigateConnectorPopup,
  publishConnectorReturnFromPopup,
  takeBufferedConnectorReturn,
  type ConnectorReturnSignal,
} from './providerReturnBridge'

const PENDING_STORAGE_KEY = 'finance-planner-connector-pending-v1'
const RETURN_STORAGE_PREFIX = 'finance-planner-connector-return-v1:'

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
})
