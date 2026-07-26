import { useRef, useState } from 'react'
import { DatabaseBackup, Download, FileKey2, FileSpreadsheet, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { exportBackup, exportTransactionsCsv, importBackup } from './backup'
import type { AppState } from './types'
import { changeVaultPassword } from './vault'

interface DataToolsProps {
  state: AppState
  onRestore: (state: AppState) => void
  onReset: () => void
}

export function DataTools({ state, onRestore, onReset }: DataToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [backupPassword, setBackupPassword] = useState('')
  const [currentVaultPassword, setCurrentVaultPassword] = useState('')
  const [newVaultPassword, setNewVaultPassword] = useState('')
  const [confirmVaultPassword, setConfirmVaultPassword] = useState('')
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
      setMessage('Verschlüsseltes Backup erfolgreich geprüft und wiederhergestellt.')
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
      setMessage('Vault-Passwort geändert. Der komplette Datenspeicher wurde mit einem neuen Salt und Schlüssel neu verschlüsselt.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vault-Passwort konnte nicht geändert werden.')
    } finally { setBusy(false) }
  }

  const reset = () => {
    if (!window.confirm('Alle verschlüsselten Finanzdaten und Einstellungen auf diesem Gerät unwiderruflich löschen?')) return
    onReset()
    setMessage('Lokale Daten wurden zurückgesetzt. Beim Neuladen wird ein neuer Vault eingerichtet.')
  }

  return <div className="data-tools-page">
    <section className="panel assistant-hero">
      <div><p className="eyebrow">Datensouveränität</p><h2>Verschlüsselung, Backup und Export</h2><p>Der lokale Vault und vollständige Backups sind verschlüsselt. CSV-Dateien sind für Tabellenprogramme bestimmt und bleiben Klartext.</p></div>
      <ShieldCheck size={30}/>
    </section>
    <section className="panel security-form-panel">
      <div><p className="eyebrow">Vault-Sicherheit</p><h2>Passwort ändern</h2><p className="muted">Das aktuelle Passwort wird geprüft. Danach wird der gesamte Vault mit einem neuen Salt und AES-Schlüssel neu verschlüsselt.</p></div>
      <div className="security-fields">
        <label>Aktuelles Passwort<input type="password" autoComplete="current-password" value={currentVaultPassword} onChange={(event) => setCurrentVaultPassword(event.target.value)}/></label>
        <label>Neues Passwort<input type="password" minLength={12} autoComplete="new-password" value={newVaultPassword} onChange={(event) => setNewVaultPassword(event.target.value)}/></label>
        <label>Neues Passwort wiederholen<input type="password" minLength={12} autoComplete="new-password" value={confirmVaultPassword} onChange={(event) => setConfirmVaultPassword(event.target.value)}/></label>
        <button disabled={busy || !currentVaultPassword || newVaultPassword.length < 12} className="primary" onClick={updateVaultPassword}><FileKey2 size={17}/> Passwort ändern</button>
      </div>
    </section>
    <section className="panel backup-password-panel">
      <label>Backup-Passwort<input type="password" minLength={12} autoComplete="new-password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} placeholder="Mindestens 12 Zeichen"/></label>
      <p className="muted">Dieses Passwort gilt nur für die exportierte Sicherungsdatei. Ohne Passwort ist das Backup nicht wiederherstellbar.</p>
    </section>
    <section className="goal-card-grid">
      <article className="panel big-goal"><div className="goal-hero-icon"><DatabaseBackup size={24}/></div><p className="eyebrow">AES-256-GCM</p><h2>Verschlüsseltes Backup</h2><span>Konten, Transaktionen und Sparziele in einer passwortgeschützten Datei.</span><button disabled={busy} className="primary data-action" onClick={createBackup}><Download size={17}/> Backup herunterladen</button></article>
      <article className="panel big-goal"><div className="goal-hero-icon"><FileSpreadsheet size={24}/></div><p className="eyebrow">Achtung: Klartext</p><h2>CSV-Export</h2><span>Sensible Transaktionsdaten ohne Verschlüsselung. Nur auf einem sicheren Gerät speichern.</span><button className="secondary data-action" onClick={() => exportTransactionsCsv(state)}><FileSpreadsheet size={17}/> CSV exportieren</button></article>
      <article className="panel big-goal"><div className="goal-hero-icon"><Upload size={24}/></div><p className="eyebrow">Wiederherstellung</p><h2>Backup importieren</h2><span>Akzeptiert verschlüsselte Finance-Planner-Backups bis 10 MB.</span><input ref={inputRef} hidden type="file" accept=".fpbackup,application/octet-stream" onChange={(event) => restore(event.target.files?.[0])}/><button disabled={busy} className="secondary data-action" onClick={() => inputRef.current?.click()}><Upload size={17}/> Backup auswählen</button></article>
      <article className="panel big-goal danger-card"><div className="goal-hero-icon"><RotateCcw size={24}/></div><p className="eyebrow">Lokales Gerät</p><h2>Vault löschen</h2><span>Entfernt den verschlüsselten Datenspeicher unwiderruflich. Vorher ein Backup erstellen.</span><button className="secondary data-action" onClick={reset}><RotateCcw size={17}/> Zurücksetzen</button></article>
    </section>
    {message && <p className="status-message success-message">{message}</p>}
    {error && <p className="status-message error-message" role="alert">{error}</p>}
  </div>
}
