import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}))

import { startAuthentication } from '@simplewebauthn/browser'

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
}

const AUTHENTICATED_USER = { id: 'google:1', email: 'demo@finance-planner.test', name: 'Demo User', passkeyCount: 0 }

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('AuthGate: session restoration (AUTH-01/AUTH-02)', () => {
  it('shows a calm loading state with no fake progress while the session check is in flight', () => {
    vi.spyOn(window, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session.')
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('offers a retry after all session-check attempts fail, without implying the user was logged out', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'We could not check your session yet' })).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getByText(/not been signed out/i)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()

    const fetchMock = vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: true, user: AUTHENTICATED_USER }))
    fireEvent.click(screen.getByRole('button', { name: /check session again/i }))
    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalled()
  }, 10000)
})

describe('AuthGate: production login (AUTH-03)', () => {
  beforeEach(() => vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: false, user: null })))

  it('shows Google as the primary option and never shows a username/password registration form', async () => {
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in to Finance Planner' })).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^email$/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/test password/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/register|sign up|create account/i)).not.toBeInTheDocument()
  })

  it('redirects to the real Google endpoint (no popup, no fake success)', async () => {
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /continue with google/i }))

    const originalLocation = window.location
    // @ts-expect-error -- jsdom allows reassigning location for this narrow check
    delete window.location
    window.location = { ...originalLocation, href: '' } as Location
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(window.location.href).toBe('/api/auth/google/start')
    window.location = originalLocation
  })

  it('shows the passkey option when the browser supports WebAuthn', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true })
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with a passkey/i })).toBeInTheDocument())
    // @ts-expect-error -- test-only cleanup
    delete window.PublicKeyCredential
  })

  it('omits the passkey option honestly (no universal-support claim) when WebAuthn is unavailable', async () => {
    // @ts-expect-error -- ensure PublicKeyCredential is absent for this check
    delete window.PublicKeyCredential
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in to Finance Planner' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /sign in with a passkey/i })).not.toBeInTheDocument()
    expect(screen.getByText(/aren't available on this browser or device/i)).toBeInTheDocument()
  })

  it('keeps the test-password path hidden from normal production UX', async () => {
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in to Finance Planner' })).toBeInTheDocument())
    expect(screen.queryByText(/test account sign-in/i)).not.toBeInTheDocument()
  })

  it('exposes deterministic test-account sign-in only in acceptance-fixture builds', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByText(/test account sign-in/i)).toBeInTheDocument())
  })
})

describe('AuthGate: passkey failure handling (AUTH-04)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true })
    vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: false, user: null }))
  })

  it('maps a cancelled WebAuthn ceremony to plain-language copy and offers Google as a fallback', async () => {
    vi.mocked(startAuthentication).mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }))
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('passkeys/authenticate/options')) return jsonResponse({})
      return jsonResponse({ authenticated: false, user: null })
    })
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /sign in with a passkey/i }))

    fireEvent.click(screen.getByRole('button', { name: /sign in with a passkey/i }))
    await waitFor(() => expect(screen.getByText('Passkey sign-in is not available right now')).toBeInTheDocument())
    expect(screen.getByText(/cancelled or timed out/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try passkey again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
  })
})

describe('AuthGate: passkey setup invocation boundary', () => {
  it('"Set up passkey" calls the real registration ceremony (Finance Planner never fakes the OS dialog itself)', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true })
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('passkeys/register/options')) return jsonResponse({})
      return jsonResponse({ authenticated: true, user: AUTHENTICATED_USER })
    })
    const startRegistrationMock = vi.mocked((await import('@simplewebauthn/browser')).startRegistration)
    startRegistrationMock.mockImplementation(() => new Promise(() => {}))

    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /set up passkey/i }))
    fireEvent.click(screen.getByRole('button', { name: /set up passkey/i }))
    await waitFor(() => expect(startRegistrationMock).toHaveBeenCalled())
    // @ts-expect-error -- test-only cleanup
    delete window.PublicKeyCredential
  })
})

describe('AuthGate: passkey recommendation (AUTH-05)', () => {
  it('offers to set up a passkey after sign-in and lets the user dismiss it without blocking the app', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true })
    vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: true, user: AUTHENTICATED_USER }))

    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByText(/add a passkey for faster sign-in/i)).toBeInTheDocument())
    expect(screen.getByText(/vault stays separate/i)).toBeInTheDocument()
    expect(screen.getByText('App content')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /dismiss passkey recommendation/i }))
    await waitFor(() => expect(screen.queryByText(/add a passkey for faster sign-in/i)).not.toBeInTheDocument())
    expect(localStorage.getItem('finance-planner-passkey-prompt-dismissed-v1')).toBe('true')
  })
})
