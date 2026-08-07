import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Fingerprint, KeyRound, LogIn, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { RUNTIME_SURFACE_PRIORITY } from './runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtime-surfaces/runtimeSurfaceContext'

export interface AuthUser { id: string; email: string; name: string; picture?: string; passkeyCount: number }
interface AuthGateProps { children: ReactNode | ((user: AuthUser) => ReactNode) }
const PASSKEY_PROMPT_KEY = 'finance-planner-passkey-prompt-dismissed-v1'

/**
 * Deterministic, build-time-gated presentation states for Step 11 reference
 * screenshots (AUTH-01/02/04). Only ever read when VITE_ACCEPTANCE_FIXTURES
 * is 'true'. Never calls Google or triggers a real WebAuthn ceremony.
 */
export type AuthAcceptanceMode = 'loading' | 'session-error' | 'passkey-error' | 'passkey-unsupported'
const ACCEPTANCE_MODES: AuthAcceptanceMode[] = ['loading', 'session-error', 'passkey-error', 'passkey-unsupported']

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || 'Sign-in failed.')
  return payload
}

const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

// The server (auth-router.js) already returns clean, user-safe English error
// text for its own failures (expired challenge, verification failed, etc.),
// so those pass through unchanged. Only the browser/WebAuthn ceremony's own
// DOMException names need translating into non-technical language.
const PASSKEY_CEREMONY_ERROR_COPY: Record<string, string> = {
  NotAllowedError: 'The passkey request was cancelled or timed out.',
  AbortError: 'The passkey request was interrupted before it finished.',
  SecurityError: "This device or browser isn't set up for passkey sign-in on this site.",
}

function describePasskeyError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined
  if (name && name in PASSKEY_CEREMONY_ERROR_COPY) return PASSKEY_CEREMONY_ERROR_COPY[name]
  return error instanceof Error ? error.message : 'The passkey request did not complete.'
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passkeyError, setPasskeyError] = useState('')
  const [busyAction, setBusyAction] = useState<'password' | 'passkey' | null>(null)
  const [promptDismissed, setPromptDismissed] = useState(() => localStorage.getItem(PASSKEY_PROMPT_KEY) === 'true')
  const [acceptanceMode, setAcceptanceMode] = useState<AuthAcceptanceMode | null>(null)
  const passkeysSupported = acceptanceMode === 'passkey-unsupported'
    ? false
    : typeof window !== 'undefined' && Boolean(window.PublicKeyCredential)
  const passkeyRecommendationActive = Boolean(user && user.passkeyCount === 0 && passkeysSupported && !promptDismissed)
  const showPasskeyRecommendation = useRuntimeSurface(runtimeSurfaceRegistration(
    'passkey',
    passkeyRecommendationActive,
    RUNTIME_SURFACE_PRIORITY.recommendationPasskey,
    { exclusive: true, blocksLower: true },
  ))

  const loadSession = useCallback(async () => {
    setLoading(true)
    setSessionError('')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const session = await api<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/session')
        setUser(session.authenticated ? session.user : null)
        setLoading(false)
        return
      } catch (reason) {
        if (attempt < 2) {
          await wait(250 * (attempt + 1))
          continue
        }
        setSessionError(reason instanceof Error ? reason.message : 'We could not check your session.')
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadSession() }, [loadSession])

  useEffect(() => {
    if (import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true') return
    const target = window as Window & { __financePlannerAuthAcceptanceState?: (mode: string) => void }
    target.__financePlannerAuthAcceptanceState = (mode) => {
      setAcceptanceMode(ACCEPTANCE_MODES.includes(mode as AuthAcceptanceMode) ? mode as AuthAcceptanceMode : null)
    }
    return () => { delete target.__financePlannerAuthAcceptanceState }
  }, [])

  async function passkeyLogin() {
    setBusyAction('passkey'); setPasskeyError('')
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkeys/authenticate/options', { method: 'POST', body: JSON.stringify({ email }) })
      const credential = await startAuthentication({ optionsJSON: options })
      await api('/api/auth/passkeys/authenticate/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session'); setUser(session.user)
    } catch (reason) {
      console.error('Passkey authentication failed', reason)
      setPasskeyError(describePasskeyError(reason))
    } finally { setBusyAction(null) }
  }

  async function passwordLogin() {
    setBusyAction('password'); setPasswordError('')
    try {
      const result = await api<{ user: AuthUser }>('/api/auth/test-password/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      setPassword('')
      setUser(result.user)
    } catch (reason) { setPasswordError(reason instanceof Error ? reason.message : 'Test-account sign-in failed.') } finally { setBusyAction(null) }
  }

  async function registerPasskey() {
    setBusyAction('passkey'); setPasskeyError('')
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' })
      const credential = await startRegistration({ optionsJSON: options })
      await api('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session'); setUser(session.user)
    } catch (reason) {
      console.error('Passkey enrollment failed', reason)
      setPasskeyError(describePasskeyError(reason))
    } finally { setBusyAction(null) }
  }

  const dismissPrompt = () => { localStorage.setItem(PASSKEY_PROMPT_KEY, 'true'); setPromptDismissed(true) }

  if (loading || acceptanceMode === 'loading') return (
    <main className="auth-screen" lang="en">
      <section className="auth-loading" role="status" aria-live="polite">
        <div className="goal-hero-icon"><ShieldCheck size={28}/></div>
        <p className="auth-brand">Finance Planner</p>
        <p className="muted">Checking your session.</p>
      </section>
    </main>
  )

  const forcedSessionError = acceptanceMode === 'session-error' ? 'The connection to the sign-in service timed out.' : ''
  if ((sessionError || forcedSessionError) && !user) return (
    <main className="auth-screen" lang="en">
      <section className="panel auth-card">
        <div className="goal-hero-icon"><ShieldCheck size={28}/></div>
        <p className="eyebrow">Session status</p>
        <h1>We could not check your session yet</h1>
        <p className="muted">You have not been signed out. We just could not reach the sign-in service when the app reloaded.</p>
        <p className="status-message error-message" role="alert">{sessionError || forcedSessionError}</p>
        <button className="fp-action-primary" type="button" onClick={() => void loadSession()}><RefreshCw size={18}/> Check session again</button>
      </section>
    </main>
  )

  const forcedPasskeyError = acceptanceMode === 'passkey-error' && !passkeyError ? 'The passkey request was cancelled or timed out.' : ''
  if (!user) return (
    <main className="auth-screen" lang="en">
      <section className="panel auth-card">
        <div className="goal-hero-icon"><ShieldCheck size={28}/></div>
        <h1>Sign in to Finance Planner</h1>
        <p className="muted">Your financial data stays encrypted on this device. Signing in only confirms who you are, unlocking your encrypted vault is a separate step after this.</p>
        <button className="auth-google" type="button" onClick={() => { window.location.href = '/api/auth/google/start' }}><LogIn size={18}/> Continue with Google</button>
        {passkeysSupported ? (
          (passkeyError || forcedPasskeyError) ? (
            <div className="auth-passkey-error">
              <p className="auth-passkey-error-title">Passkey sign-in is not available right now</p>
              <p className="muted">{passkeyError || forcedPasskeyError}</p>
              <button type="button" className="auth-google" disabled={busyAction !== null} onClick={() => void passkeyLogin()}>
                <Fingerprint size={19}/>{busyAction === 'passkey' ? 'Checking your passkey…' : 'Try passkey again'}
              </button>
            </div>
          ) : (
            <>
              <div className="auth-divider"><span>or</span></div>
              <button className="auth-google" type="button" disabled={busyAction !== null} onClick={() => void passkeyLogin()}>
                <Fingerprint size={19}/>{busyAction === 'passkey' ? 'Checking your passkey…' : 'Sign in with a passkey'}
              </button>
            </>
          )
        ) : (
          <p className="auth-passkey-unsupported">Passkeys aren't available on this browser or device yet. Continue with Google above.</p>
        )}
        <p className="auth-redirect-note">Continuing with Google opens a new step on Google's site, then returns you here. Finance Planner never asks for your Google password.</p>
        {import.meta.env.VITE_ACCEPTANCE_FIXTURES === 'true' && (
          <details className="auth-test-password">
            <summary>Test account sign-in (acceptance builds only)</summary>
            <label>Email<input autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="demo@finance-planner.test"/></label>
            <label>Test password<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && email && password && busyAction === null) void passwordLogin() }}/></label>
            <button className="fp-action-primary" type="button" disabled={busyAction !== null || !email || !password} onClick={() => void passwordLogin()}>
              <KeyRound size={19}/>{busyAction === 'password' ? 'Checking…' : 'Sign in with test password'}
            </button>
            {passwordError && <p className="status-message error-message" role="alert">{passwordError}</p>}
          </details>
        )}
      </section>
    </main>
  )

  const content = typeof children === 'function' ? children(user) : children
  return <>
    {showPasskeyRecommendation && (
      <div className="passkey-enrolment runtime-surface runtime-surface--prompt runtime-optional-surface" role="status" lang="en">
        <span>Add a passkey for faster sign-in on supported devices. This protects your account sign-in only, your encrypted vault stays separate and still needs its own password.</span>
        <button type="button" disabled={busyAction !== null} onClick={() => void registerPasskey()}><Fingerprint size={17}/> Set up passkey</button>
        <button type="button" aria-label="Dismiss passkey recommendation" title="Not now" onClick={dismissPrompt}><X size={18}/></button>
      </div>
    )}
    {content}
  </>
}
