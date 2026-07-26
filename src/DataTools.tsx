import { useRef, useState } from 'react'
import { DatabaseBackup, Download, FileSpreadsheet, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import { exportBackup, exportTransactionsCsv, importBackup } from './backup'
import type { AppState } from './types'

interface DataToolsProps {
  state: AppState
  onRestore: (state: AppState) => void
  onReset: () => void
}

export function DataTools({ state, onRestore, onReset }: DataToolsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const restore = async (file?: File) => {
    if (!file) return
    setError('')
    setMessage('')
    try {
      const restored = await importBackup(file)
      onRestore(restored)
      setMessage('Backup erfolgreich geprüft und wiederhergestellt.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Backup konnte nicht importiert werden.')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const reset = () => {
    if (!window.confirm('Alle lokalen Finanzdaten und Einstellungen auf diesem Gerät zurücksetzen?')) return
    onReset()
    setMessage('Lokale Daten wurden zurückgesetzt.')
  }

  return <div className="data-tools-page">
    <section className="panel assistant-hero">
      <div><p className="eyebrow">Datensouveränität</p><h2>Backup, Export und Wiederherstellung</h2><p>Erstelle regelmäßig ein lokales Backup. Importierte Dateien werden vor der Übernahme vollständig validiert.</p></div>
      <ShieldCheck size={30}/>
    </section>
    <section className="goal-card-grid">
      <article className="panel big-goal">
        <div className="goal-hero-icon"><DatabaseBackup size={24}/></div><p className="eyebrow">Vollständige Sicherung</p><h2>JSON-Backup</h2><span>Konten, Transaktionen und Sparziele in einer portablen Datei.</span><button className="primary data-action" onClick={() => exportBackup(state)}><Download size={17}/> Backup herunterladen</button>
      </article>
      <article className="panel big-goal">
        <div className="goal-hero-icon"><FileSpreadsheet size={24}/></div><p className="eyebrow">Auswertung</p><h2>CSV-Export</h2><span>Transaktionen im deutschen CSV-Format für Tabellenkalkulationen.</span><button className="secondary data-action" onClick={() => exportTransactionsCsv(state)}><FileSpreadsheet size={17}/> CSV exportieren</button>
      </article>
      <article className="panel big-goal">
        <div className="goal-hero-icon"><Upload size={24}/></div><p className="eyebrow">Wiederherstellung</p><h2>Backup importieren</h2><span>Nur gültige Finance-Planner-Backups bis 10 MB werden akzeptiert.</span><input ref={inputRef} hidden type="file" accept="application/json,.json" onChange={(event) => restore(event.target.files?.[0])}/><button className="secondary data-action" onClick={() => inputRef.current?.click()}><Upload size={17}/> Backup auswählen</button>
      </article>
      <article className="panel big-goal danger-card">
        <div className="goal-hero-icon"><RotateCcw size={24}/></div><p className="eyebrow">Lokales Gerät</p><h2>Daten zurücksetzen</h2><span>Entfernt den lokalen App-Zustand. Vorher ein Backup erstellen.</span><button className="secondary data-action" onClick={reset}><RotateCcw size={17}/> Zurücksetzen</button>
      </article>
    </section>
    {message && <p className="status-message success-message">{message}</p>}
    {error && <p className="status-message error-message" role="alert">{error}</p>}
  </div>
}
