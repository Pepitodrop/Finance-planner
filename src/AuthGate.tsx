import { useEffect, useState, type ReactNode } from 'react'
import { Fingerprint, LogIn, ShieldCheck, X } from 'lucide-react'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

interface AuthUser { id: string; email: string; name: string; picture?: string; passkeyCount: number }
interface AuthGateProps { children: ReactNode }
const PASSKEY_PROMPT_KEY = 'finance-planner-passkey-prompt-dismissed-v1'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'Anmeldung fehlgeschlagen.')
  return payload
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [promptDismissed, setPromptDismissed] = useState(() => localStorage.getItem(PASSKEY_PROMPT_KEY) === 'true')
  const passkeysSupported = typeof window !== 'undefined' && Boolean(window.PublicKeyCredential)

  useEffect(() => { api<{ authenticated: boolean; user: AuthUser | null }>('/api/auth/session').then((session) => setUser(session.authenticated ? session.user : null)).catch(() => setUser(null)).finally(() => setLoading(false)) }, [])

  async function passkeyLogin() {
    setBusy(true); setError('')
    try {
      const options = await api<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/api/auth/passkeys/authenticate/options', { method: 'POST', body: JSON.stringify({ email }) })
      const credential = await startAuthentication({ optionsJSON: options })
      await api('/api/auth/passkeys/authenticate/verify', { method: 'POST', body: JSON.stringify(credential) })
      const session = await api<{ user: AuthUser }>('/api/auth/session'); setUser(session.user)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Biometrische Anmeldung fehlgeschlagen.') } finally { setBusy(false) }
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
  if (loading) return <main className="auth-screen"><p>Sichere Sitzung wird geladen …</p></main>
  if (!user) return <main className="auth-screen"><section className="panel auth-card"><div className="goal-hero-icon"><ShieldCheck size={28}/></div><p className="eyebrow">Sichere mobile Anmeldung</p><h1>Bei Finance Planner anmelden</h1><p className="muted">Nutze Google oder einen Geräte-Passkey. Biometrische Daten bleiben auf deinem Gerät.</p><button className="auth-google" type="button" onClick={() => { window.location.href = '/api/auth/google/start' }}><LogIn size={18}/> Mit Google fortfahren</button>{passkeysSupported && <><div className="auth-divider"><span>oder</span></div><label>E-Mail<input autoComplete="email webauthn" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="du@beispiel.de"/></label><button className="primary" type="button" disabled={busy || !email} onClick={passkeyLogin}><Fingerprint size={19}/>{busy ? 'Wird geprüft …' : 'Face ID oder Fingerabdruck verwenden'}</button></>}{error && <p className="status-message error-message" role="alert">{error}</p>}</section></main>

  return <>{user.passkeyCount === 0 && passkeysSupported && !promptDismissed && <div className="passkey-enrolment" role="status"><span>Schnellere Anmeldung mit Face ID oder Fingerabdruck aktivieren.</span><button type="button" disabled={busy} onClick={registerPasskey}><Fingerprint size={17}/> Biometrische Anmeldung aktivieren</button><button type="button" aria-label="Hinweis ausblenden" title="Nicht mehr anzeigen" onClick={dismissPrompt}><X size={18}/></button></div>}{children}</>
}
