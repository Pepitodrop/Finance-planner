import { useRef, useState } from 'react'
import { DatabaseBackup, Download, FileKey2, FileSpreadsheet, RotateCcw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { exportBackup, exportTransactionsCsv, importBackup } from './backup'
import { clearUnlockedState } from './storage'
import type { AppState } from './types'
import { changeVaultPassword, removeEncryptedVault } from './vault'

interface DataToolsProps {
  userId: string
  state: AppState
  onRestore: (state: AppState) => void
  onReset: () => void
}

const ACCOUNT_DELETE_CONFIRMATION = 'DELETE MY ACCOUNT'

function apiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message
  return fallback
}

function clearAccountDeviceMetadata(userId: string): void {
  const suffix = encodeURIComponent(userId)
  localStorage.removeItem(`finance-planner-cloud-conflict-v2:${suffix}`)
  localStorage.removeItem(`finance-planner-cloud-metadata-v1:${suffix}`)
}

export function DataTools({ userId, state, onRestore, onReset }: DataToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [backupPassword, setBackupPassword] = useState('')
  const [currentVaultPassword, setCurrentVaultPassword] = useState('')
  const [newVaultPassword, setNewVaultPassword] = useState('')
  const [confirmVaultPassword, setConfirmVaultPassword] = useState('')
  const [deletionConfirmation, setDeletionConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const createBackup = async () => {
    setError(''); setMessage(''); setBusy(true)
    try {
      await exportBackup(state, backupPassword)
      setMessage('Verschlüsseltes Backup wurde erstellt. Bewahre Passwort und Datei getrennt auf.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backup konnte nicht erstellt werden.')
    } finally { setBusy(false) }
  }

  const restore = async (file?: File) => {
    if (!file) return
    setError(''); setMessage(''); setBusy(true)
    try {
      const restored = await importBackup(file, backupPassword)
      onRestore(restored)
      setMessage('Verschlüsseltes Backup erfolgreich geprüft und wiederhergestellt. Der wiederhergestellte Stand wird mit deinem Konto synchronisiert.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backup konnte nicht importiert werden.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const updateVaultPassword = async () => {
    setError(''); setMessage('')
    if (newVaultPassword !== confirmVaultPassword) { setError('Die neuen Passwörter stimmen nicht überein.'); return }
    setBusy(true)
    try {
      await changeVaultPassword(currentVaultPassword, newVaultPassword)
      setCurrentVaultPassword(''); setNewVaultPassword(''); setConfirmVaultPassword('')
      setMessage('Vault-Passwort geändert. Der komplette lokale Datenspeicher wurde mit einem neuen Salt und Schlüssel neu verschlüsselt.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vault-Passwort konnte nicht geändert werden.')
    } finally { setBusy(false) }
  }

  const reset = () => {
    if (!window.confirm('Alle Finanzdaten, Lernwerte und Einstellungen dieses Kontos zurücksetzen? Der leere Stand wird mit PostgreSQL und deinen anderen Geräten synchronisiert.')) return
    onReset()
    setMessage('Der Kontodatenstand wurde lokal zurückgesetzt und wird als leerer Stand mit der Cloud synchronisiert.')
  }

  const deleteAccount = async () => {
    if (deletionConfirmation !== ACCOUNT_DELETE_CONFIRMATION || busy) return
    const confirmed = window.confirm('Konto wirklich endgültig löschen? Alle Cloud-Finanzdaten, Lernprofile, Bankverbindungen, Passkeys und die Sitzung werden entfernt. Diese Aktion kann nicht rückgängig gemacht werden.')
    if (!confirmed) return
    setError(''); setMessage(''); setBusy(true)
    try {
      const response = await fetch('/api/auth/account', {
        method: 'DELETE',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: ACCOUNT_DELETE_CONFIRMATION }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || (payload as { deleted?: unknown }).deleted !== true) {
        throw new Error(apiError(payload, 'Das Konto konnte nicht vollständig gelöscht werden.'))
      }
      clearUnlockedState()
      removeEncryptedVault(userId)
      clearAccountDeviceMetadata(userId)
      sessionStorage.clear()
      window.location.assign('/')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Das Konto konnte nicht vollständig gelöscht werden.')
      setBusy(false)
    }
  }

  return <div className="data-tools-page">
    <section className="panel assistant-hero data-tools-hero">
      <div><p className="eyebrow">Datensouveränität</p><h2>Verschlüsselung, Backup und Export</h2><p>Der lokale Vault und vollständige Backups sind verschlüsselt. PostgreSQL hält die verschlüsselte kontogebundene Cloud-Kopie. CSV-Dateien sind für Tabellenprogramme bestimmt und bleiben Klartext.</p></div>
      <ShieldCheck size={30}/>
    </section>
    <section className="panel security-form-panel">
      <div className="security-form-copy"><p className="eyebrow">Vault-Sicherheit</p><h2>Passwort ändern</h2><p className="muted">Das aktuelle Passwort wird geprüft. Danach wird der gesamte lokale Geräte-Vault mit einem neuen Salt und AES-Schlüssel neu verschlüsselt. Das Passwort wird nicht an den Server übertragen.</p></div>
      <div className="security-fields">
        <label className="security-field-current">Aktuelles Passwort<input type="password" autoComplete="current-password" value={currentVaultPassword} onChange={(event) => setCurrentVaultPassword(event.target.value)}/></label>
        <label>Neues Passwort<input type="password" minLength={12} autoComplete="new-password" value={newVaultPassword} onChange={(event) => setNewVaultPassword(event.target.value)}/></label>
        <label>Neues Passwort wiederholen<input type="password" minLength={12} autoComplete="new-password" value={confirmVaultPassword} onChange={(event) => setConfirmVaultPassword(event.target.value)}/></label>
        <button type="button" disabled={busy || !currentVaultPassword || newVaultPassword.length < 12} className="primary security-submit" onClick={() => void updateVaultPassword()}><FileKey2 size={17}/> Passwort ändern</button>
      </div>
    </section>
    <section className="panel backup-password-panel">
      <label>Backup-Passwort<input type="password" minLength={12} autoComplete="new-password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} placeholder="Mindestens 12 Zeichen"/></label>
      <p className="muted">Dieses Passwort gilt nur für die exportierte Sicherungsdatei. Ohne Passwort ist das Backup nicht wiederherstellbar.</p>
    </section>
    <section className="goal-card-grid data-card-grid">
      <article className="panel big-goal data-card"><div className="goal-hero-icon"><DatabaseBackup size={24}/></div><p className="eyebrow">AES-256-GCM</p><h2>Verschlüsseltes Backup</h2><span>Konten, Transaktionen und Sparziele in einer passwortgeschützten Datei.</span><button type="button" disabled={busy} className="primary data-action" onClick={() => void createBackup()}><Download size={17}/> Backup herunterladen</button></article>
      <article className="panel big-goal data-card"><div className="goal-hero-icon"><FileSpreadsheet size={24}/></div><p className="eyebrow">Achtung: Klartext</p><h2>CSV-Export</h2><span>Sensible Transaktionsdaten ohne Verschlüsselung. Nur auf einem sicheren Gerät speichern.</span><button type="button" className="secondary data-action" onClick={() => exportTransactionsCsv(state)}><FileSpreadsheet size={17}/> CSV exportieren</button></article>
      <article className="panel big-goal data-card"><div className="goal-hero-icon"><Upload size={24}/></div><p className="eyebrow">Wiederherstellung</p><h2>Backup importieren</h2><span>Akzeptiert verschlüsselte Finance-Planner-Backups bis 10 MB und synchronisiert den geprüften Stand anschließend.</span><input ref={inputRef} hidden type="file" accept=".fpbackup,application/octet-stream" onChange={(event) => void restore(event.target.files?.[0])}/><button type="button" disabled={busy} className="secondary data-action" onClick={() => inputRef.current?.click()}><Upload size={17}/> Backup auswählen</button></article>
      <article className="panel big-goal data-card danger-card"><div className="goal-hero-icon"><RotateCcw size={24}/></div><p className="eyebrow">Kontoweit</p><h2>Finanzdaten zurücksetzen</h2><span>Ersetzt Konten, Transaktionen, Sparziele und persönliche Lernwerte durch den leeren Ausgangsstand und synchronisiert ihn auf deine Geräte.</span><button type="button" className="secondary data-action" onClick={reset}><RotateCcw size={17}/> Kontodaten zurücksetzen</button></article>
    </section>
    <section className="panel account-deletion-panel" aria-labelledby="account-deletion-title">
      <div className="account-deletion-copy">
        <p className="eyebrow">Endgültige Kontolöschung</p>
        <h2 id="account-deletion-title">Konto und sämtliche Serverdaten löschen</h2>
        <p>Entfernt den verschlüsselten Cloud-Datenstand, das Lernprofil, Bank- und PayPal-Verbindungen, offene OAuth-Vorgänge, Passkeys und das Anmeldekonto. Bestehende Sitzungen werden widerrufen. Lokale Daten dieses Kontos werden anschließend von diesem Gerät entfernt.</p>
        <p className="muted">Erstelle vorher ein verschlüsseltes Backup. Eine Kontolöschung kann nicht rückgängig gemacht werden.</p>
      </div>
      <div className="account-deletion-controls">
        <label>Zur Bestätigung exakt <code>{ACCOUNT_DELETE_CONFIRMATION}</code> eingeben
          <input
            autoComplete="off"
            spellCheck={false}
            value={deletionConfirmation}
            onChange={(event) => setDeletionConfirmation(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="danger-action"
          disabled={busy || deletionConfirmation !== ACCOUNT_DELETE_CONFIRMATION}
          onClick={() => void deleteAccount()}
        ><Trash2 size={17}/>{busy ? 'Konto wird gelöscht …' : 'Konto endgültig löschen'}</button>
      </div>
    </section>
    {message && <p className="status-message success-message" role="status">{message}</p>}
    {error && <p className="status-message error-message" role="alert">{error}</p>}
  </div>
}