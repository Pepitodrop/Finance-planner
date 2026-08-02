import { useEffect, useRef, useState } from 'react'
import { BrainCircuit, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { createAutomaticTransactionAnalysis, transactionAnalysisRevision } from './automaticTransactionAnalysis'
import { loadState } from './storage'

const POLL_INTERVAL_MS = 1_500
const ANALYSIS_DEBOUNCE_MS = 500

export function AutomaticTransactionAnalysis() {
  const [analysis, setAnalysis] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const revisionRef = useRef('')
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    const analyze = () => {
      const state = loadState()
      const revision = transactionAnalysisRevision(state)
      if (revision === revisionRef.current) return
      revisionRef.current = revision
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        setAnalysis(createAutomaticTransactionAnalysis(state))
        setUpdatedAt(new Date())
      }, ANALYSIS_DEBOUNCE_MS)
    }

    analyze()
    const interval = window.setInterval(analyze, POLL_INTERVAL_MS)
    const onVisibility = () => { if (document.visibilityState === 'visible') analyze() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(interval)
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  if (!analysis) return null

  return <aside className={`automatic-analysis ${expanded ? 'expanded' : ''}`} aria-live="polite">
    <button type="button" className="automatic-analysis__header" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
      <BrainCircuit size={18}/>
      <span><strong>Transaktionsanalyse aktuell</strong><small>{updatedAt ? `Automatisch aktualisiert um ${updatedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Wird automatisch aktualisiert'}</small></span>
      {expanded ? <ChevronDown size={17}/> : <ChevronUp size={17}/>} 
    </button>
    {expanded && <div className="automatic-analysis__body"><p>{analysis}</p><div className="automatic-analysis__privacy"><RefreshCw size={14}/> Läuft automatisch und regelbasiert auf deinen bereits entschlüsselten App-Daten. Es werden dafür keine Daten an externe KI-Anbieter gesendet.</div></div>}
  </aside>
}
