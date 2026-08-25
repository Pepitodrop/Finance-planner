import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthGate } from './AuthGate'

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(),
}))

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
}

const AUTHENTICATED_USER = { id: 'email:1', email: 'demo@finance-planner.test', name: 'Demo User', passkeyCount: 0 }

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

describe('AuthGate: session restoration', () => {
  it('shows a calm loading state while the session check is in flight', () => {
    vi.spyOn(window, 'fetch').mockReturnValue(new Promise(() => {}))
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session.')
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('offers a retry after session checks fail without implying logout', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'We could not check your session yet' })).toBeInTheDocument(), { timeout: 5000 })
    expect(screen.getByText(/not been signed out/i)).toBeInTheDocument()
  }, 10000)
})

describe('AuthGate: production login', () => {
  it('shows exactly the requested Google and email/password choices', async () => {
    vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: false, user: null }))
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Sign in to Finance Planner' })).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in with email/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create an account/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign in with a passkey/i })).not.toBeInTheDocument()
  })

  it('uses the general password endpoint, including for a configured test account', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/password/login')) return jsonResponse({ authenticated: true, user: AUTHENTICATED_USER })
      return jsonResponse({ authenticated: false, user: null })
    })
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => screen.getByLabelText(/^email$/i))

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'demo@finance-planner.test' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in with email/i }))

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password/login', expect.objectContaining({ method: 'POST' }))
  })

  it('switches to registration and posts name/email/password to the registration endpoint', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/password/register')) return jsonResponse({ authenticated: true, user: AUTHENTICATED_USER })
      return jsonResponse({ authenticated: false, user: null })
    })
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /create an account/i }))
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }))

    expect(screen.getByRole('heading', { name: 'Create your Finance Planner account' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Demo User' } })
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'demo@finance-planner.test' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'correct horse battery staple' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'correct horse battery staple' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))

    await waitFor(() => expect(screen.getByText('App content')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password/register', expect.objectContaining({ method: 'POST' }))
  })

  it('rejects mismatched registration passwords before a network call', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: false, user: null }))
    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /create an account/i }))
    fireEvent.click(screen.getByRole('button', { name: /create an account/i }))
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'demo@example.com' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'correct horse battery staple' } })
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'different long password' } })
    fireEvent.click(screen.getByRole('button', { name: /^create account$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('AuthGate: passkey recommendation after sign-in', () => {
  it('offers optional passkey setup after authentication, not as a third primary login choice', async () => {
    Object.defineProperty(window, 'PublicKeyCredential', { value: class {}, configurable: true })
    vi.spyOn(window, 'fetch').mockReturnValue(jsonResponse({ authenticated: true, user: AUTHENTICATED_USER }))

    render(<AuthGate>{() => <div>App content</div>}</AuthGate>)
    await waitFor(() => expect(screen.getByText(/add a passkey for faster sign-in/i)).toBeInTheDocument())
    expect(screen.getByText('App content')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /set up passkey/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /dismiss passkey recommendation/i }))
    await waitFor(() => expect(screen.queryByText(/add a passkey for faster sign-in/i)).not.toBeInTheDocument())
    expect(localStorage.getItem('finance-planner-passkey-prompt-dismissed-v1')).toBe('true')
    // @ts-expect-error test-only cleanup
    delete window.PublicKeyCredential
  })
})

describe('AuthGate: sign-out', () => {
  it('clears the current browser session and returns to the sign-in screen', async () => {
    const fetchMock = vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/logout')) return jsonResponse({ authenticated: false })
      return jsonResponse({ authenticated: true, user: AUTHENTICATED_USER })
    })

    render(<AuthGate>{(user, { logout }) => <button onClick={() => void logout()}>Sign out as {user.name}</button>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /sign out as demo user/i }))
    fireEvent.click(screen.getByRole('button', { name: /sign out as demo user/i }))

    await waitFor(() => expect(screen.getByRole('heading', { name: /sign in to finance planner/i })).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }))
  })

  // A bank-connection popup attempt binds to this browser TAB
  // (sessionStorage), not to any particular user session -- without
  // clearing it on logout, a different user signing into the same tab
  // afterward could have the previous user's stale attempt silently
  // accepted by the popup-return bridge (attemptId/provider matching alone,
  // with no notion of "which account is this for" at the client-storage
  // layer). See providerReturnBridge.ts's clearPendingConnectorAttempt().
  it('clears any in-flight bank-connection popup attempt on logout, so a different user in the same tab cannot inherit it', async () => {
    vi.spyOn(window, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.includes('/api/auth/logout')) return jsonResponse({ authenticated: false })
      return jsonResponse({ authenticated: true, user: AUTHENTICATED_USER })
    })
    sessionStorage.setItem('finance-planner-connector-pending-v1', JSON.stringify({ attemptId: 'a'.repeat(16), provider: 'enablebanking', createdAt: Date.now() }))

    render(<AuthGate>{(user, { logout }) => <button onClick={() => void logout()}>Sign out as {user.name}</button>}</AuthGate>)
    await waitFor(() => screen.getByRole('button', { name: /sign out as demo user/i }))
    fireEvent.click(screen.getByRole('button', { name: /sign out as demo user/i }))

    await waitFor(() => expect(sessionStorage.getItem('finance-planner-connector-pending-v1')).toBeNull())
  })
})
