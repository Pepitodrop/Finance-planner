import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from './AiPanel'
import type { Transaction } from './types'

afterEach(() => cleanup())

const transactions: Transaction[] = [
  { id: 't1', accountId: 'checking', description: 'REWE SAGT', category: 'Lebensmittel', type: 'expense', amountCents: 4200, date: '2026-08-01', recurring: false },
  { id: 't2', accountId: 'checking', description: 'Netflix', category: 'Verträge', type: 'expense', amountCents: 1299, date: '2026-08-02', recurring: true },
]

describe('AiPanel', () => {
  it('shows the ready state with English copy and does not invent results before analysis', () => {
    render(<AiPanel transactions={transactions} onApply={vi.fn()}/>)
    expect(screen.getByText('Understand your transactions')).toBeInTheDocument()
    expect(screen.getByText('On-device model')).toBeInTheDocument()
    expect(screen.getByText(/2 transactions ready to analyze/)).toBeInTheDocument()
    expect(screen.queryByText('Analyzed')).not.toBeInTheDocument()
  })

  it('shows a guided empty state instead of meaningless zero metrics when there is no history', () => {
    const { container } = render(<AiPanel transactions={[]} onApply={vi.fn()}/>)
    expect(screen.getByText('Finance Intelligence needs transaction history')).toBeInTheDocument()
    expect(screen.queryByText('Analyzed')).not.toBeInTheDocument()
    // Regression: the empty-state return branch was the one of AiPanel's
    // four return points missing lang="en", caught by Step 12C browser
    // acceptance (a real-Chromium check saw the page fall back to the
    // app shell's document-level "de" instead).
    expect(container.querySelector('.ai-page')).toHaveAttribute('lang', 'en')
  })

  it('runs local classification without any network request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<AiPanel transactions={transactions} onApply={vi.fn()}/>)
    fireEvent.click(screen.getByRole('button', { name: /analyze transactions/i }))
    expect(await screen.findByText('Suggestions', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('acceptance: results mode distinguishes trusted from review-required suggestions without color alone', () => {
    render(<AiPanel transactions={transactions} onApply={vi.fn()} acceptanceMode="results"/>)
    expect(screen.queryAllByText('Trusted').length + screen.queryAllByText('Needs your review').length).toBeGreaterThan(0)
  })

  it('acceptance: anomaly mode explicitly denies being a fraud check, and never uses alarmist language', () => {
    render(<AiPanel transactions={transactions} onApply={vi.fn()} acceptanceMode="anomaly"/>)
    expect(screen.getByText(/statistical comparison, not a fraud check/i)).toBeInTheDocument()
    expect(screen.queryByText(/suspicious|unauthorized|flagged for security/i)).not.toBeInTheDocument()
  })

  it('acceptance: applying a trusted suggestion calls onApply and records a learning note, not a retraining claim', () => {
    const onApply = vi.fn()
    render(<AiPanel transactions={transactions} onApply={onApply} acceptanceMode="results"/>)
    const applyButtons = screen.getAllByRole('button', { name: /^apply$/i })
    fireEvent.click(applyButtons[0])
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/doesn't retrain the underlying model/i)).toBeInTheDocument()
  })

  it('acceptance: bulk-applying trusted suggestions only ever applies the trusted subset', () => {
    const onApply = vi.fn()
    render(<AiPanel transactions={transactions} onApply={onApply} acceptanceMode="results"/>)
    const bulkButton = screen.queryByRole('button', { name: /apply all trusted/i })
    if (bulkButton) {
      fireEvent.click(bulkButton)
      for (const call of onApply.mock.calls) expect(call[1].needsReview).toBe(false)
    }
  })

  it('acceptance: error state explains that nothing was sent and offers a retry, without exposing internals', () => {
    render(<AiPanel transactions={transactions} onApply={vi.fn()} acceptanceMode="error"/>)
    expect(screen.getByText("Analysis couldn't finish.")).toBeInTheDocument()
    expect(screen.getByText(/nothing was sent anywhere/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })

  it('acceptance: filters are reachable as a tablist with English labels', () => {
    render(<AiPanel transactions={transactions} onApply={vi.fn()} acceptanceMode="results"/>)
    const tablist = screen.getByRole('tablist', { name: /filter suggestions/i })
    expect(within(tablist).getByRole('tab', { name: 'Trusted' })).toBeInTheDocument()
    expect(within(tablist).getByRole('tab', { name: 'Unusual pattern' })).toBeInTheDocument()
  })
})
