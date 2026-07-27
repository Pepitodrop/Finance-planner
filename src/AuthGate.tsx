import { useEffect, useState, type ReactNode } from 'react'
import { Fingerprint, LogIn, ShieldCheck } from 'lucide-react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

interface AuthUser {
  id: string
  email: string
  name: string
  picture?: string
  passkeyCount: number
}

interface AuthGateProps { children: ReactNode }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Authentication failed.')
  return payload
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential)

  useEffect(() => {
    api<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/session')
      .then((session) => setUser(session.authenticated ? session.user : null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function passkeyLogin() {
    setBusy(true)
    setError('')
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkeys/authenticate/options', { method: 'POST', body: JSON.stringify({ email }) })
      const credential = await startAuthentication({ optionsJSON: options })
      await api('/api/auth/passkeys/authenticate/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session')
      setUser(session.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Biometric login failed.')
    } finally {
      setBusy(false)
    }
  }

  async function registerPasskey() {
    setBusy(true)
    setError('')
    try {
      const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' })
      const credential = await startRegistration({ optionsJSON: options })
      await api('/api/auth/passkeys/register/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session')
      setUser(session.user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Passkey registration failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <main className="auth-screen"><p>Secure session is loading…</p></main>

  if (!user) return <main className="auth-screen">
    <section className="panel auth-card">
      <div className="goal-hero-icon"><ShieldCheck size={28}/></div>
      <p className="eyebrow">Secure mobile sign-in</p>
      <h1>Sign in to Finance Planner</h1>
      <p className="muted">Use Google or a device passkey. Face ID, Touch ID, Android biometrics, or the device PIN stay on your phone and are never sent to Finance Planner.</p>
      <button className="auth-google" type="button" onClick={() => { window.location.href = '/api/auth/google/start' }}><LogIn size={18}/> Continue with Google</button>
      {passkeysSupported && <>
        <div className="auth-divider"><span>or</span></div>
        <label>Email<input autoComplete="email webauthn" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <button className="primary" type="button" disabled={busy || !email} onClick={passkeyLogin}><Fingerprint size={19}/>{busy ? 'Checking…' : 'Use Face ID or fingerprint'}</button>
      </>}
      {error && <p className="status-message error-message" role="alert">{error}</p>}
    </section>
  </main>

  return <>
    {user.passkeyCount === 0 && passkeysSupported && <div className="passkey-enrolment" role="status">
      <span>Enable faster sign-in with Face ID or fingerprint.</span>
      <button type="button" disabled={busy} onClick={registerPasskey}><Fingerprint size={17}/> Enable biometric login</button>
    </div>}
    {children}
  </>
}
