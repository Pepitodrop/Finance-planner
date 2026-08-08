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
const ACCEPTANCE_ANALYSIS = ['Automatic transaction analysis', 'Spending rising: Your expenses this month so far are 12% above the same period last month.', '3.4 months runway: Your available balance covers at least three months of current spending.'].join('\n\n')

export type AutomaticAnalysisAcceptanceMode = 'compact' | 'expanded'

export function AutomaticTransactionAnalysis() {
  const [analysis, setAnalysis] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [acceptanceMode, setAcceptanceMode] = useState<AutomaticAnalysisAcceptanceMode | null>(null)
  // null (not '') so a genuinely empty account's real revision (also '' --
  // see transactionAnalysisRevision) is never mistaken for "unchanged since
  // mount", which would otherwise skip the first analysis entirely.
  const revisionRef = useRef<string | null>(null)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    const analyze = () => {
      if (acceptanceMode) return
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
  }, [acceptanceMode])

  useEffect(() => {
    if (import.meta.env.VITE_ACCEPTANCE_FIXTURES !== 'true') return
    const target = window as Window & { __financePlannerAutoAcceptanceState?: (mode: string) => void }
    target.__financePlannerAutoAcceptanceState = (mode) => {
      if (mode === 'compact' || mode === 'expanded') {
        setAcceptanceMode(mode)
        setAnalysis(ACCEPTANCE_ANALYSIS)
        setExpanded(mode === 'expanded')
        setUpdatedAt(new Date('2026-08-07T14:32:00'))
      } else if (mode === 'reset') {
        setAcceptanceMode(null)
        setAnalysis('')
        setExpanded(false)
        setUpdatedAt(null)
        revisionRef.current = null
      }
    }
    return () => { delete target.__financePlannerAutoAcceptanceState }
  }, [])

  useEffect(() => {
    if (!analysis || expanded || acceptanceMode) return
    const timer = window.setTimeout(() => setAnalysis(''), COMPLETED_STATUS_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [analysis, expanded, acceptanceMode])

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
