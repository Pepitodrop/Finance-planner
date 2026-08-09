import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Fingerprint, KeyRound, LogIn, RefreshCw, ShieldCheck, UserPlus, X } from 'lucide-react'
import { startRegistration } from '@simplewebauthn/browser'
import { RUNTIME_SURFACE_PRIORITY } from './runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtime-surfaces/runtimeSurfaceContext'

export interface AuthUser { id: string; email: string; name: string; picture?: string; passkeyCount: number }
export interface AuthActions { logout: () => Promise<void> }
interface AuthGateProps { children: ReactNode | ((user: AuthUser, actions: AuthActions) => ReactNode) }
const PASSKEY_PROMPT_KEY = 'finance-planner-passkey-prompt-dismissed-v1'

export type AuthAcceptanceMode = 'loading' | 'session-error' | 'passkey-error' | 'passkey-unsupported'
const ACCEPTANCE_MODES: AuthAcceptanceMode[] = ['loading', 'session-error', 'passkey-error', 'passkey-unsupported']

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || 'Sign-in failed.')
  return payload
}

const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

const PASSKEY_CEREMONY_ERROR_COPY: Record<string, string> = {
  NotAllowedError: 'The passkey request was cancelled or timed out.',
  AbortError: 'The passkey request was interrupted before it finished.',
  SecurityError: "This device or browser isn't set up for passkeys on this site.",
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
  const [credentialsMode, setCredentialsMode] = useState<'signin' | 'register'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
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

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPasswordError('')
    if (credentialsMode === 'register' && password !== passwordConfirmation) {
      setPasswordError('The passwords do not match.')
      return
    }
    setBusyAction('password')
    try {
      const path = credentialsMode === 'register' ? '/api/auth/password/register' : '/api/auth/password/login'
      const body = credentialsMode === 'register' ? { name, email, password } : { email, password }
      const result = await api<{ user: AuthUser }>(path, { method: 'POST', body: JSON.stringify(body) })
      setPassword('')
      setPasswordConfirmation('')
      setUser(result.user)
    } catch (reason) {
      setPasswordError(reason instanceof Error ? reason.message : credentialsMode === 'register' ? 'Account creation failed.' : 'Sign-in failed.')
    } finally {
      setBusyAction(null)
    }
  }

  async function registerPasskey() {
    setBusyAction('passkey'); setPasskeyError('')
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' })
      const credential = await startRegistration({ optionsJSON: options })
      await api('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session')
      setUser(session.user)
    } catch (reason) {
      console.error('Passkey enrollment failed', reason)
      setPasskeyError(describePasskeyError(reason))
    } finally { setBusyAction(null) }
  }

  const dismissPrompt = () => { localStorage.setItem(PASSKEY_PROMPT_KEY, 'true'); setPromptDismissed(true) }

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])

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

  if (!user) return (
    <main className="auth-screen" lang="en">
      <section className="panel auth-card auth-card--credentials">
        <div className="goal-hero-icon"><ShieldCheck size={28}/></div>
        <h1>{credentialsMode === 'register' ? 'Create your Finance Planner account' : 'Sign in to Finance Planner'}</h1>
        <p className="muted">Choose Google or your Finance Planner email and password. Account sign-in stays separate from the password that encrypts your financial vault.</p>

        <button className="auth-google" type="button" onClick={() => { window.location.href = '/api/auth/google/start' }}><LogIn size={18}/> Continue with Google</button>
        <div className="auth-divider"><span>or use email</span></div>

        <form className="auth-credentials-form" onSubmit={submitCredentials}>
          {credentialsMode === 'register' && <label>Name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} placeholder="Your name"/></label>}
          <label>Email<input autoComplete="email" inputMode="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required/></label>
          <label>Password<input autoComplete={credentialsMode === 'register' ? 'new-password' : 'current-password'} type="password" minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required/></label>
          {credentialsMode === 'register' && <label>Confirm password<input autoComplete="new-password" type="password" minLength={12} maxLength={200} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required/></label>}
          {credentialsMode === 'register' && <p className="auth-form-hint">Use at least 12 characters. Your account password and encrypted-vault password are independent.</p>}
          {passwordError && <p className="status-message error-message" role="alert">{passwordError}</p>}
          <button className="fp-action-primary auth-credentials-submit" type="submit" disabled={busyAction !== null || !email || password.length < 12 || (credentialsMode === 'register' && passwordConfirmation.length < 12)}>
            {credentialsMode === 'register' ? <UserPlus size={19}/> : <KeyRound size={19}/>}
            {busyAction === 'password' ? 'Please wait…' : credentialsMode === 'register' ? 'Create account' : 'Sign in with email'}
          </button>
        </form>

        <button type="button" className="auth-mode-switch" onClick={() => {
          setCredentialsMode((current) => current === 'signin' ? 'register' : 'signin')
          setPasswordError('')
          setPassword('')
          setPasswordConfirmation('')
        }}>
          {credentialsMode === 'signin' ? 'New to Finance Planner? Create an account' : 'Already have an account? Sign in'}
        </button>
        <p className="auth-redirect-note">Google sign-in redirects to Google and safely returns here. Finance Planner never asks for your Google password. The same email/password form also works for the configured test account.</p>
      </section>
    </main>
  )

  const forcedPasskeyError = acceptanceMode === 'passkey-error' && !passkeyError ? 'The passkey request was cancelled or timed out.' : ''
  const content = typeof children === 'function' ? children(user, { logout }) : children
  return <>
    {showPasskeyRecommendation && (
      <div className="passkey-enrolment runtime-surface runtime-surface--prompt runtime-optional-surface" role="status" lang="en">
        <span>{passkeyError || forcedPasskeyError || 'Add a passkey for faster sign-in on supported devices. This protects account sign-in only; your encrypted vault remains separate.'}</span>
        <button type="button" disabled={busyAction !== null} onClick={() => void registerPasskey()}><Fingerprint size={17}/> {busyAction === 'passkey' ? 'Setting up…' : passkeyError || forcedPasskeyError ? 'Try again' : 'Set up passkey'}</button>
        <button type="button" aria-label="Dismiss passkey recommendation" title="Not now" onClick={dismissPrompt}><X size={18}/></button>
      </div>
    )}
    {content}
  </>
}
