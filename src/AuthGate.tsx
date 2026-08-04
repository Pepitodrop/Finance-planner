import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Fingerprint, KeyRound, LogIn, RefreshCw, ShieldCheck, X } from 'lucide-react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { RUNTIME_SURFACE_PRIORITY } from './runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtime-surfaces/runtimeSurfaceContext'

export interface AuthUser { id: string; email: string; name: string; picture?: string; passkeyCount: number }
interface AuthGateProps { children: ReactNode | ((user: AuthUser) => ReactNode) }
const PASSKEY_PROMPT_KEY = 'finance-planner-passkey-prompt-dismissed-v1'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || 'Anmeldung fehlgeschlagen.')
  return payload
}

const wait = (milliseconds: number) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds))

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [promptDismissed, setPromptDismissed] = useState(() => localStorage.getItem(PASSKEY_PROMPT_KEY) === 'true')
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential)
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
        setSessionError(reason instanceof Error ? reason.message : 'Die bestehende Sitzung konnte nicht geprüft werden.')
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadSession() }, [loadSession])

  async function passkeyLogin() {
    setBusy(true); setError('')
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkeys/authenticate/options', { method: 'POST', body: JSON.stringify({ email }) })
      const credential = await startAuthentication({ optionsJSON: options })
      await api('/api/auth/passkeys/authenticate/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session'); setUser(session.user)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Biometrische Anmeldung fehlgeschlagen.') } finally { setBusy(false) }
  }

  async function passwordLogin() {
    setBusy(true); setError('')
    try {
      const result = await api<{ user: AuthUser }>('/api/auth/test-password/login', { method: 'POST', body: JSON.stringify({ email, password }) })
      setPassword('')
      setUser(result.user)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Anmeldung mit Testpasswort fehlgeschlagen.') } finally { setBusy(false) }
  }

  async function registerPasskey() {
    setBusy(true); setError('')
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' })
      const credential = await startRegistration({ optionsJSON: options })
      await api('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session'); setUser(session.user)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Passkey-Registrierung fehlgeschlagen.') } finally { setBusy(false) }
  }

  const dismissPrompt = () => { localStorage.setItem(PASSKEY_PROMPT_KEY, 'true'); setPromptDismissed(true) }
  if (loading) return <main className="auth-screen"><p>Sichere Sitzung wird wiederhergestellt …</p></main>
  if (sessionError && !user) return <main className="auth-screen"><section className="panel auth-card"><div className="goal-hero-icon"><ShieldCheck size={28}/></div><p className="eyebrow">Sitzung bleibt erhalten</p><h1>Sitzung konnte noch nicht geprüft werden</h1><p className="muted">Du wurdest nicht automatisch abgemeldet. Die Verbindung zum Anmeldedienst ist beim Neuladen fehlgeschlagen.</p><p className="status-message error-message" role="alert">{sessionError}</p><button className="primary" type="button" onClick={() => void loadSession()}><RefreshCw size={18}/> Sitzung erneut prüfen</button></section></main>
  if (!user) return <main className="auth-screen"><section className="panel auth-card"><div className="goal-hero-icon"><ShieldCheck size={28}/></div><p className="eyebrow">Sichere mobile Anmeldung</p><h1>Bei Finance Planner anmelden</h1><p className="muted">Nutze Google, einen Geräte-Passkey oder das serverseitig eingerichtete Testkonto.</p><button className="auth-google" type="button" onClick={() => { window.location.href = '/api/auth/google/start' }}><LogIn size={18}/> Mit Google fortfahren</button><div className="auth-divider"><span>oder</span></div><label>E-Mail<input autoComplete="email webauthn" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="demo@finance-planner.test"/></label><label>Testpasswort<input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Testpasswort" onKeyDown={(event) => { if (event.key === 'Enter' && email && password && !busy) void passwordLogin() }}/></label><button className="primary" type="button" disabled={busy || !email || !password} onClick={passwordLogin}><KeyRound size={19}/>{busy ? 'Wird geprüft …' : 'Mit Testpasswort anmelden'}</button>{passkeysSupported && <button className="auth-google" type="button" disabled={busy || !email} onClick={passkeyLogin}><Fingerprint size={19}/>{busy ? 'Wird geprüft …' : 'Mit Passkey anmelden'}</button>}{error && <p className="status-message error-message" role="alert">{error}</p>}</section></main>

  const content = typeof children === 'function' ? children(user) : children
  return <>{showPasskeyRecommendation && <div className="passkey-enrolment runtime-surface runtime-surface--prompt runtime-optional-surface" role="status"><span>Set up a passkey for faster sign-in on supported devices. Your encrypted vault remains separate.</span><button type="button" disabled={busy} onClick={registerPasskey}><Fingerprint size={17}/> Set up passkey</button><button type="button" aria-label="Dismiss passkey recommendation" title="Do not show again" onClick={dismissPrompt}><X size={18}/></button></div>}{content}</>
}
