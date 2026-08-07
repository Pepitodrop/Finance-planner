import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomaticTransactionAnalysis } from './AutomaticTransactionAnalysis'
import { emptyProductionState } from './data'
import { RuntimeSurfaceCoordinator } from './runtime-surfaces/RuntimeSurfaceCoordinator'
import { configureAuthenticatedStorage, setUnlockedState } from './storage'

describe('AutomaticTransactionAnalysis status', () => {
  afterEach(() => vi.useRealTimers())

  it('announces a completed revision once and clears the compact status automatically', async () => {
    vi.useFakeTimers()
    render(<RuntimeSurfaceCoordinator><AutomaticTransactionAnalysis/></RuntimeSurfaceCoordinator>)
    await act(async () => vi.advanceTimersByTime(500))
    expect(screen.getByText('Transaktionsanalyse aktuell')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(4_000))
    expect(screen.queryByText('Transaktionsanalyse aktuell')).not.toBeInTheDocument()
  })

  describe('genuinely empty account (Step 11 first-run state)', () => {
    beforeEach(() => {
      localStorage.clear()
      configureAuthenticatedStorage('automatic-analysis-empty-user')
      setUnlockedState(structuredClone(emptyProductionState))
    })

    it('CRITICAL: still announces on first mount instead of treating zero transactions as "no change since mount"', async () => {
      // Regression: transactionAnalysisRevision([]) === '', which used to
      // equal the ref's initial sentinel value, so the very first analysis
      // was silently skipped for a brand-new, genuinely empty vault -- this
      // only started mattering once Step 11 stopped seeding demo data into
      // fresh vaults.
      vi.useFakeTimers()
      render(<RuntimeSurfaceCoordinator><AutomaticTransactionAnalysis/></RuntimeSurfaceCoordinator>)
      await act(async () => vi.advanceTimersByTime(500))
      expect(screen.getByText('Transaktionsanalyse aktuell')).toBeInTheDocument()
    })
  })
})
