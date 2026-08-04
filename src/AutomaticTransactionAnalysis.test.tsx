import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutomaticTransactionAnalysis } from './AutomaticTransactionAnalysis'
import { RuntimeSurfaceCoordinator } from './runtime-surfaces/RuntimeSurfaceCoordinator'

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
})
