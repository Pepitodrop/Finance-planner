import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react'
import { shouldLockAfterBackground, setPrivacyShield } from './mobile-security'
import { clearLegacyPlaintextState, hasLegacyPlaintextState, loadLegacyState, setUnlockedState } from './storage'
import { createVault, hasEncryptedVault, lockVault, unlockVault } from './vault'

interface VaultGateProps { children: ReactNode }

type Mode = 'setup' | 'unlock' | 'open'
const AUTO_LOCK_MS = 15 * 60 * 1000

export function VaultGate({ children }: VaultGateProps) {
  const [mode, setMode] = useState<Mode>(() => hasEncryptedVault() ? 'unlock' : 'setup')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    if (mode !== 'open') return

    const lockNow = () => {
      setPrivacyShield(true)
      lockVault()
      window.location.reload()
    }

    let timer = window.setTimeout(lockNow, AUTO_LOCK_MS)
    const resetTimer = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lockNow, AUTO_LOCK_MS)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        backgroundedAt.current = Date.now()
        setPrivacyShield(true)
        return
      }

      const mustLock = shouldLockAfterBackground(backgroundedAt.current, Date.now())
      backgroundedAt.current = null
      if (mustLock) {
        lockNow()
        return
      }
      setPrivacyShield(false)
      resetTimer()
    }
    const handlePageHide = () => {
      setPrivacyShield(true)
      lockVault()
    }

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll']
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }))
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)

    return () => {
      window.clearTimeout(timer)
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer))
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      setPrivacyShield(false)
    }
  }, [mode])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'setup') {
        if (password.length < 12) throw new Error('Das Passwort muss mindestens 12 Zeichen lang sein.')
        if (password !== confirmation) throw new Error('Die Passwörter stimmen nicht überein.')
        const state = loadLegacyState()
        await createVault(password, state)
        setUnlockedState(state)
        clearLegacyPlaintextState()
      } else {
        const state = await unlockVault(password)
        setUnlockedState(state)
      }
      setPassword('')
      setConfirmation('')
      setPrivacyShield(false)
      setMode('open')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Der Datenspeicher konnte nicht geöffnet werden.')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'open') {
    return <>{children}<button className="vault-lock-button" type="button" onClick={() => { setPrivacyShield(true); lockVault(); window.location.reload() }}><LockKeyhole size={16}/> Sperren</button></>
  }

  const migrating = mode === 'setup' && hasLegacyPlaintextState()
  return <main className="vault-screen">
    <section className="panel vault-card">
      <div className="goal-hero-icon"><ShieldCheck size={26}/></div>
      <p className="eyebrow">Lokale Ende-zu-Ende-Verschlüsselung</p>
      <h1>{mode === 'setup' ? 'Sicheren Datenspeicher einrichten' : 'Finance Planner entsperren'}</h1>
      <p className="muted">Konten, Transaktionen und Sparziele werden mit AES-256-GCM verschlüsselt. Der Schlüssel wird aus deinem Passwort abgeleitet, nur im Arbeitsspeicher gehalten und nach 15 Minuten Inaktivität oder spätestens 30 Sekunden im Hintergrund entfernt.</p>
      {migrating && <p className="status-message">Bestehende Klartextdaten werden nach erfolgreicher Einrichtung verschlüsselt und anschließend entfernt.</p>}
      <form onSubmit={submit} className="vault-form">
        <label>Passwort<input autoFocus autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} minLength={12} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required/></label>
        {mode === 'setup' && <label>Passwort wiederholen<input autoComplete="new-password" minLength={12} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required/></label>}
        {error && <p className="status-message error-message" role="alert">{error}</p>}
        <button className="primary" disabled={busy} type="submit"><KeyRound size={18}/>{busy ? 'Schlüssel wird abgeleitet …' : mode === 'setup' ? 'Verschlüsselung aktivieren' : 'Entsperren'}</button>
      </form>
      <div className="vault-warning"><strong>Wichtig:</strong> Es gibt keine Passwort-Wiederherstellung. Ohne Passwort können die lokalen Daten nicht entschlüsselt werden. Erstelle regelmäßig ein Backup.</div>
    </section>
  </main>
}
