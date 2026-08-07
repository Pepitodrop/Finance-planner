import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ListChecks, RefreshCw } from 'lucide-react'
import { createAutomaticTransactionAnalysis, transactionAnalysisRevision } from './automaticTransactionAnalysis'
import { IntelligenceBadge } from './IntelligenceBadge'
import { loadState } from './storage'
import { RUNTIME_SURFACE_PRIORITY } from './runtime-surfaces/runtimeSurfacePolicy'
import { runtimeSurfaceRegistration, useRuntimeSurface } from './runtime-surfaces/runtimeSurfaceContext'

const POLL_INTERVAL_MS = 1_500
const ANALYSIS_DEBOUNCE_MS = 500
const COMPLETED_STATUS_DURATION_MS = 4_000

export function AutomaticTransactionAnalysis() {
  const [analysis, setAnalysis] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  // null (not '') so a genuinely empty account's real revision (also '' --
  // see transactionAnalysisRevision) is never mistaken for "unchanged since
  // mount", which would otherwise skip the first analysis entirely.
  const revisionRef = useRef<string | null>(null)
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

  useEffect(() => {
    if (!analysis || expanded) return
    const timer = window.setTimeout(() => setAnalysis(''), COMPLETED_STATUS_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [analysis, expanded])

  const visible = useRuntimeSurface(runtimeSurfaceRegistration(
    'analysis',
    Boolean(analysis),
    RUNTIME_SURFACE_PRIORITY.informational,
  ))

  if (!visible) return null

  return <aside className={`automatic-analysis runtime-surface runtime-surface--informational ${expanded ? 'expanded' : ''}`} aria-live="polite" aria-atomic="true" lang="en">
    <button type="button" className="automatic-analysis__header" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
      <ListChecks size={18}/>
      <span><strong>Transaction check up to date</strong><small>{updatedAt ? `Updated at ${updatedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Updates automatically'}</small></span>
      {expanded ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}
    </button>
    {expanded && <div className="automatic-analysis__body">
      <IntelligenceBadge kind="calculated"/>
      <p>{analysis}</p>
      <div className="automatic-analysis__privacy"><RefreshCw size={14}/> Runs automatically and rule-based on your already-decrypted app data. No data is sent to any external AI provider for this.</div>
    </div>}
  </aside>
}
