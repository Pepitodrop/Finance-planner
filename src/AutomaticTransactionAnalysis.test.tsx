import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomaticTransactionAnalysis } from './AutomaticTransactionAnalysis'
import { emptyProductionState } from './data'
import { RuntimeSurfaceCoordinator } from './runtime-surfaces/RuntimeSurfaceCoordinator'
import { configureAuthenticatedStorage, setUnlockedState } from './storage'

describe('AutomaticTransactionAnalysis status', () => {
  afterEach(() => { vi.useRealTimers(); cleanup() })

  it('announces a completed revision once and clears the compact status automatically', async () => {
    vi.useFakeTimers()
    render(<RuntimeSurfaceCoordinator><AutomaticTransactionAnalysis/></RuntimeSurfaceCoordinator>)
    await act(async () => vi.advanceTimersByTime(500))
    expect(screen.getByText('Transaction check up to date')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(4_000))
    expect(screen.queryByText('Transaction check up to date')).not.toBeInTheDocument()
  })

  describe('acceptance fixture', () => {
    beforeEach(() => vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true'))
    afterEach(() => vi.unstubAllEnvs())

    it('forces a compact status that does not auto-fade, and an expanded status with the Calculated badge', async () => {
      vi.useFakeTimers()
      render(<RuntimeSurfaceCoordinator><AutomaticTransactionAnalysis/></RuntimeSurfaceCoordinator>)
      await act(async () => vi.advanceTimersByTime(500))
      const hook = (window as unknown as { __financePlannerAutoAcceptanceState: (mode: string) => void }).__financePlannerAutoAcceptanceState
      expect(typeof hook).toBe('function')

      act(() => hook('compact'))
      await act(async () => vi.advanceTimersByTime(4_000))
      expect(screen.getByText('Transaction check up to date')).toBeInTheDocument()

      act(() => hook('expanded'))
      expect(screen.getByText('Calculated')).toBeInTheDocument()
      expect(screen.getByText(/Runs automatically and rule-based/)).toBeInTheDocument()
    })
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
      expect(screen.getByText('Transaction check up to date')).toBeInTheDocument()
    })
  })
})
