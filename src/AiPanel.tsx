import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCheck, CircleCheck, Filter, Info, ListChecks, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, WandSparkles } from 'lucide-react'
import { classifyTransaction, generateInsights, type AiSuggestion } from './ai'
import { buildAiReviewSummary, isTrustedSuggestion, matchesAiReviewFilter, pendingTrustedSuggestionIds, requiresHumanReview, type AiReviewFilter } from './aiReview'
import { formatMoney } from './finance'
import { IntelligenceBadge } from './IntelligenceBadge'
import type { Transaction } from './types'
import './ai.css'

export type AiPanelAcceptanceMode = 'ready' | 'progress' | 'results' | 'anomaly' | 'applied' | 'error' | 'empty'

interface AiPanelProps {
  transactions: Transaction[]
  onApply: (transactionId: string, suggestion: AiSuggestion) => void
  acceptanceMode?: AiPanelAcceptanceMode
}

const filters: Array<{ key: AiReviewFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'trusted', label: 'Trusted' },
  { key: 'review', label: 'Review' },
  { key: 'recurring', label: 'Recurring' },
  { key: 'anomaly', label: 'Unusual pattern' },
]

function acceptanceSuggestion(overrides: Partial<AiSuggestion> = {}): AiSuggestion {
  return {
    category: 'Lebensmittel', merchant: 'REWE', confidence: 91, explanation: 'Matched based on similar wording to 6 transactions you previously categorized as Lebensmittel.',
    recurringProbability: 12, anomalyScore: 8, alternatives: [{ category: 'Lebensmittel', confidence: 91 }, { category: 'Shopping', confidence: 34 }],
    needsReview: false, source: 'behavior', ...overrides,
  }
}

export function AiPanel({ transactions, onApply, acceptanceMode }: AiPanelProps) {
  const [suggestions, setSuggestions] = useState<Record<string, AiSuggestion>>({})
  const [loading, setLoading] = useState(false)
  const [progressIndex, setProgressIndex] = useState<{ index: number; total: number; description: string } | null>(null)
  const [hasAnalyzed, setHasAnalyzed] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<AiReviewFilter>(acceptanceMode === 'anomaly' ? 'anomaly' : 'all')
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set())
  const [appliedMessage, setAppliedMessage] = useState('')
  const insights = useMemo(() => generateInsights(transactions), [transactions])

  useEffect(() => {
    if (!acceptanceMode || acceptanceMode === 'empty') return
    if (acceptanceMode === 'ready') { setHasAnalyzed(false); setSuggestions({}); setError(''); return }
    if (acceptanceMode === 'error') { setHasAnalyzed(true); setError('The on-device model did not load or run correctly this time. Nothing was sent anywhere, and no changes were made to your transactions.'); return }
    if (acceptanceMode === 'progress') { setHasAnalyzed(false); setLoading(true); setProgressIndex({ index: 46, total: 142, description: transactions[0]?.description ?? 'Rewe SAGT' }); return }
    const next: Record<string, AiSuggestion> = {}
    transactions.forEach((transaction, index) => {
      if (acceptanceMode === 'anomaly' && index % 3 !== 0) return
      next[transaction.id] = acceptanceSuggestion(
        acceptanceMode === 'anomaly'
          ? { anomalyScore: 78, explanation: 'Amount is well above your typical spending in this category.' }
          : index % 4 === 3
            ? { confidence: 52, needsReview: true, category: 'Sonstiges', explanation: 'The signals are not clear enough. Confirm a category so your personal pattern history can learn from it.' }
            : {},
      )
    })
    setHasAnalyzed(true)
    setSuggestions(next)
    if (acceptanceMode === 'applied') setAppliedIds(new Set(transactions.filter((_, index) => index % 4 !== 3).map((transaction) => transaction.id)))
    if (acceptanceMode === 'applied') setAppliedMessage('18 trusted suggestions applied.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptanceMode])

  const summary = useMemo(() => buildAiReviewSummary(suggestions), [suggestions])
  const pendingTrustedIds = useMemo(
    () => pendingTrustedSuggestionIds(transactions.map((transaction) => transaction.id), suggestions, appliedIds),
    [appliedIds, suggestions, transactions],
  )
  const visibleTransactions = useMemo(
    () => transactions.filter((transaction) => matchesAiReviewFilter(suggestions[transaction.id], filter)),
    [filter, suggestions, transactions],
  )

  const analyze = async () => {
    setLoading(true)
    setError('')
    setAppliedIds(new Set())
    setAppliedMessage('')
    setHasAnalyzed(true)
    const next: Record<string, AiSuggestion> = {}
    try {
      for (let index = 0; index < transactions.length; index += 1) {
        const transaction = transactions[index]
        setProgressIndex({ index: index + 1, total: transactions.length, description: transaction.description })
        next[transaction.id] = await classifyTransaction(transaction.description, transaction.amountCents, transactions)
        setSuggestions({ ...next })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The on-device model did not load or run correctly this time. Nothing was sent anywhere, and no changes were made to your transactions.')
    } finally {
      setLoading(false)
      setProgressIndex(null)
    }
  }

  const applyOne = (transaction: Transaction, suggestion: AiSuggestion) => {
    if (appliedIds.has(transaction.id)) return
    onApply(transaction.id, suggestion)
    setAppliedIds((current) => new Set(current).add(transaction.id))
    setAppliedMessage(`Applied the suggestion for "${transaction.description}" and learned this as a confirmation.`)
  }

  const applyTrusted = () => {
    if (pendingTrustedIds.length === 0) return
    for (const transactionId of pendingTrustedIds) {
      const suggestion = suggestions[transactionId]
      if (suggestion && isTrustedSuggestion(suggestion)) onApply(transactionId, suggestion)
    }
    setAppliedIds((current) => {
      const next = new Set(current)
      pendingTrustedIds.forEach((transactionId) => next.add(transactionId))
      return next
    })
    setAppliedMessage(`${pendingTrustedIds.length} trusted suggestions applied.`)
  }

  if (transactions.length === 0) {
    return <div className="ai-page">
      <section className="panel ai-empty-state">
        <ListChecks size={40}/>
        <strong>Finance Intelligence needs transaction history</strong>
        <span>Add or import transactions first, then come back here to get merchant and category suggestions.</span>
      </section>
    </div>
  }

  if (!hasAnalyzed) {
    return <div className="ai-page" lang="en">
      <section className="panel ai-intro">
        <p className="eyebrow">On-device analysis</p>
        <h2>Understand your transactions</h2>
        <p>Finance Planner looks at each transaction and suggests a category, using a small model that runs in your browser. Suggestions below a trust threshold are marked for your review — nothing uncertain is applied automatically.</p>
        <IntelligenceBadge kind="local"/>
        <div className="ai-privacy-note"><ShieldCheck size={17}/><span>Model files are cached in your browser. Your transactions are not sent to any external AI service for this analysis.</span></div>
        <p className="ai-ready-count">{transactions.length} transactions ready to analyze.</p>
        <button className="primary ai-run" type="button" onClick={() => void analyze()} disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={19}/> : <WandSparkles size={19}/>} {loading ? 'Analyzing…' : 'Analyze transactions'}
        </button>
      </section>
    </div>
  }

  if (loading && progressIndex) {
    const percent = Math.round((progressIndex.index / progressIndex.total) * 100)
    return <div className="ai-page" lang="en">
      <section className="panel ai-intro">
        <p className="eyebrow">On-device analysis</p>
        <h2>Understand your transactions</h2>
        <div className="ai-progress" role="progressbar" aria-label="Transaction analysis progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${percent}%` }}/></div>
        <p className="ai-status" role="status" aria-live="polite">Analyzing {progressIndex.index} of {progressIndex.total} — {progressIndex.description.slice(0, 28)}{progressIndex.description.length > 28 ? '…' : ''}</p>
        <p className="muted">This runs in your browser and may take a moment on the first pass.</p>
      </section>
    </div>
  }

  return (
    <div className="ai-page" lang="en">
      {error && <section className="panel ai-error-state" role="alert">
        <AlertTriangle size={28}/>
        <strong>Analysis couldn't finish.</strong>
        <span>{error}</span>
        <button className="secondary" type="button" onClick={() => void analyze()}><RefreshCw size={14}/> Try again</button>
      </section>}

      <section className="ai-metrics" aria-label="Finance Intelligence overview">
        <article className="panel"><span>Analyzed</span><strong>{summary.analyzed}</strong><small>of {transactions.length} transactions</small></article>
        <article className="panel"><span>Avg. confidence</span><strong>{summary.averageConfidence}%</strong><small>calibrated estimate</small></article>
        <article className="panel"><span>Trusted</span><strong>{summary.trusted}</strong><small>ready to apply</small></article>
        <article className="panel"><span>Needs review</span><strong>{summary.needsReview}</strong><small>your confirmation</small></article>
        <article className="panel"><span>Unusual pattern</span><strong>{summary.anomalies}</strong><small>statistical outlier</small></article>
      </section>

      {filter === 'anomaly' && <aside className="ai-anomaly-note" role="note">
        <Info size={16}/>
        <span>"Unusual pattern" here means unusually large or small compared to your own past spending in that category — a statistical comparison, not a fraud check.</span>
      </aside>}

      <section className="panel table-panel ai-results">
        <div className="panel-header ai-results-header">
          <div><p className="eyebrow">Suggestions</p><h2>Review queue</h2></div>
          <div className="ai-filter" role="tablist" aria-label="Filter suggestions"><Filter size={15}/>{filters.map((item) => <button key={item.key} role="tab" aria-selected={filter === item.key} className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)}>{item.label}</button>)}</div>
        </div>
        {appliedMessage && <div className="ai-applied-banner" role="status"><CircleCheck size={17}/><div><strong>{appliedMessage}</strong><span>Finance Planner will remember these choices to improve future suggestions for the same merchants — this doesn't retrain the underlying model, it adjusts what it already knows about your own patterns.</span></div></div>}
        <div className="ai-result-list">
          {visibleTransactions.map((transaction) => {
            const suggestion = suggestions[transaction.id]
            const reviewRequired = suggestion ? requiresHumanReview(suggestion) : false
            const applied = appliedIds.has(transaction.id)
            return (
              <div className={`ai-result ${reviewRequired ? 'review-required' : ''} ${suggestion ? '' : 'unanalyzed'}`} key={transaction.id}>
                <div className="ai-result-main">
                  <strong>{transaction.description}</strong>
                  <span>{formatMoney(transaction.amountCents)} · currently: {transaction.category}</span>
                </div>
                {suggestion ? <>
                  <div className="ai-prediction"><b>{suggestion.merchant}</b><span>{suggestion.category}</span><IntelligenceBadge kind="local" label={`On-device model · ${suggestion.confidence}%`}/></div>
                  <div className="ai-scores"><span>Recurring {suggestion.recurringProbability}%</span><span className={suggestion.anomalyScore >= 70 ? 'warning' : ''}>Unusual pattern {suggestion.anomalyScore}%</span></div>
                  <div className="ai-explanation"><p>{suggestion.explanation}</p>{suggestion.alternatives.length > 1 && <div className="ai-alternatives">Other possibilities: {suggestion.alternatives.slice(1, 4).map((alternative) => <span key={alternative.category}>{alternative.category} {alternative.confidence}%</span>)}</div>}</div>
                  <div className="ai-decision"><span className={applied ? 'trusted-badge' : reviewRequired ? 'review-badge' : 'trusted-badge'}>{applied ? 'Applied' : reviewRequired ? 'Needs your review' : 'Trusted'}</span><button className="secondary" onClick={() => applyOne(transaction, suggestion)} disabled={applied}><Check size={15}/> {applied ? 'Applied' : 'Apply'}</button></div>
                </> : <span className="ai-waiting">Not analyzed yet</span>}
              </div>
            )
          })}
          {visibleTransactions.length === 0 && <div className="ai-empty">No suggestions match this filter.</div>}
        </div>
        {pendingTrustedIds.length > 0 && <div className="ai-bulk-bar"><span>{pendingTrustedIds.length} trusted suggestions ready</span><button className="primary" onClick={applyTrusted}><CheckCheck size={17}/> Apply all trusted</button></div>}
      </section>

      <section className="panel ai-insights">
        <div className="panel-header"><div><p className="eyebrow">Smart insights</p><h2>What stands out</h2></div><IntelligenceBadge kind="calculated"/></div>
        <div className="insight-list">
          {insights.map((insight) => <div key={insight}><Sparkles size={16}/><span>{insight}</span></div>)}
        </div>
      </section>
    </div>
  )
}
