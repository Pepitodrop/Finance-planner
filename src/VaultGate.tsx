import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { shouldLockAfterBackground, setPrivacyShield } from './mobile-security'
import {
  clearLegacyPlaintextState,
  configureAuthenticatedStorage,
  flushCloudState,
  getCloudSyncStatus,
  hasLegacyPlaintextState,
  loadLegacyState,
  prepareNewDeviceCloudBootstrap,
  saveState,
  setUnlockedState,
  subscribeCloudSyncStatus,
  synchronizeUnlockedState,
} from './storage'
import { emptyProductionState, isLegacyDemoState } from './data'
import type { AppState } from './types'
import { createVault, hasEncryptedVault, lockVault, unlockVault } from './vault'
import { VaultConflict } from './VaultConflict'

interface VaultGateProps { children: ReactNode | ((lock: () => void) => ReactNode); userId: string }

type Mode = 'setup' | 'unlock' | 'open'
const AUTO_LOCK_MS = 15 * 60 * 1000

export function VaultGate({ children, userId }: VaultGateProps) {
  const [mode, setMode] = useState<Mode>(() => {
    configureAuthenticatedStorage(userId)
    return hasEncryptedVault(userId) ? 'unlock' : 'setup'
  })
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const backgroundedAt = useRef<number | null>(null)
  const migrating = mode === 'setup' && hasLegacyPlaintextState()
  const [cloudPhase, setCloudPhase] = useState(() => getCloudSyncStatus().phase)
  const [conflictDismissed, setConflictDismissed] = useState(false)
  const [forcedConflict, setForcedConflict] = useState(false)
  const lockNow = useCallback(() => {
    void flushCloudState({ keepalive: true })
    setPrivacyShield(true)
    lockVault()
    window.location.reload()
  }, [])

  useEffect(() => {
    if (mode !== 'open') return
    return subscribeCloudSyncStatus((status) => setCloudPhase(status.phase))
  }, [mode])

  useEffect(() => { setConflictDismissed(false) }, [cloudPhase])

  useEffect(() => {
    if (mode !== 'open' || import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true') return
    const target = window as Window & { __financePlannerVaultAcceptanceState?: (mode: string) => void }
    target.__financePlannerVaultAcceptanceState = (fixtureMode) => {
      if (fixtureMode === 'conflict') setForcedConflict(true)
      if (fixtureMode === 'shielded') setPrivacyShield(true)
      if (fixtureMode === 'reset') { setForcedConflict(false); setPrivacyShield(false) }
    }
    return () => { delete target.__financePlannerVaultAcceptanceState }
  }, [mode])

  useEffect(() => {
    if (mode !== 'open') return

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
      void flushCloudState({ keepalive: true })
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
  }, [lockNow, mode])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      let state: AppState
      if (mode === 'setup') {
        if (password.length < 12) throw new Error('The password must be at least 12 characters long.')
        if (password !== confirmation) throw new Error('The passwords do not match.')
        state = migrating ? loadLegacyState() : structuredClone(emptyProductionState)
        await createVault(password, state, userId)
        if (!migrating) prepareNewDeviceCloudBootstrap()
        clearLegacyPlaintextState()
      } else {
        state = await unlockVault(password, userId)
      }
      setUnlockedState(state)
      setSyncing(true)
      let synchronizedState = await synchronizeUnlockedState(state)

      // Older production releases accidentally persisted the bundled German
      // sample dataset into real/test-account vaults. Remove only that exact
      // signature after decryption, then persist the empty state so the cloud
      // copy cannot restore the samples on the next device/reload.
      if (isLegacyDemoState(synchronizedState)) {
        synchronizedState = structuredClone(emptyProductionState)
        saveState(synchronizedState)
      }

      setUnlockedState(synchronizedState)
      setSyncing(false)
      setPassword('')
      setConfirmation('')
      setPrivacyShield(false)
      setMode('open')
    } catch (reason) {
      setSyncing(false)
      setError(reason instanceof Error ? reason.message : 'The vault could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'open') {
    const showConflict = forcedConflict || (cloudPhase === 'conflict' && !conflictDismissed)
    return <>
      {typeof children === 'function' ? children(lockNow) : children}
      {showConflict && <VaultConflict onClose={() => { setConflictDismissed(true); setForcedConflict(false) }}/>}    
    </>
  }

  return <main className="vault-screen" lang="en">
    <section className="panel vault-card">
      <div className="goal-hero-icon"><ShieldCheck size={26}/></div>
      <p className="eyebrow">Account-bound encryption + cloud sync</p>
      <h1>{mode === 'setup' ? 'Set up your encrypted vault' : 'Unlock Finance Planner'}</h1>
      {mode === 'setup'
        ? <p className="muted">This is separate from signing in. Your accounts, transactions, and goals are encrypted on this device, then synced encrypted to Finance Planner's servers so they are available on your other devices.</p>
        : <p className="muted">Enter your vault password to decrypt your data on this device. It stays on this device and is never sent to our servers.</p>}
      {migrating && <p className="status-message">We found data stored locally from before encryption was enabled. Setting up your vault will encrypt this data and use it as your starting point. If a different version already exists in the cloud, you will be asked to choose which one to keep next.</p>}
      <form onSubmit={submit} className="vault-form">
        <label>Vault password<input autoFocus autoComplete={mode === 'setup' ? 'new-password' : 'current-password'} minLength={12} type="password" value={password} onChange={(event) => setPassword(event.target.value)} required aria-describedby={mode === 'setup' ? 'vault-password-hint' : undefined}/></label>
        {mode === 'setup' && <small id="vault-password-hint" className="vault-form-hint">At least 12 characters.</small>}
        {mode === 'setup' && <label>Confirm password<input autoComplete="new-password" minLength={12} type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required/></label>}
        {error && <p className="status-message error-message" role="alert">{error}</p>}
        <button className="fp-action-primary" disabled={busy} type="submit"><KeyRound size={18}/>{busy ? (syncing ? 'Syncing your data…' : mode === 'setup' ? 'Turning on encryption…' : 'Decrypting…') : mode === 'setup' ? 'Turn on encryption' : 'Unlock'}</button>
      </form>
      {mode === 'setup'
        ? <div className="vault-warning"><strong>Important:</strong> This password cannot be recovered if you forget it. It never leaves this device. Each signed-in account gets a separate vault on this device.</div>
        : <p className="vault-form-footnote">There is no password reset for your vault. If you have forgotten it, your locally encrypted copy cannot be decrypted again.</p>}
    </section>
  </main>
}
