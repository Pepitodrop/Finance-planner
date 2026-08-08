import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AcceptanceCrashTrigger } from './AcceptanceCrashTrigger'
import { ErrorBoundary } from './ErrorBoundary'

describe('AcceptanceCrashTrigger', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    delete (window as Window & { __financePlannerCrashForAcceptance?: () => void }).__financePlannerCrashForAcceptance
  })

  it('never registers the trigger outside acceptance-fixture builds', () => {
    render(<ErrorBoundary><AcceptanceCrashTrigger/></ErrorBoundary>)
    expect((window as Window & { __financePlannerCrashForAcceptance?: () => void }).__financePlannerCrashForAcceptance).toBeUndefined()
  })

  it('crashes into the real ErrorBoundary page when invoked under acceptance fixtures', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<ErrorBoundary><AcceptanceCrashTrigger/></ErrorBoundary>)

    const trigger = (window as Window & { __financePlannerCrashForAcceptance?: () => void }).__financePlannerCrashForAcceptance
    expect(trigger).toBeTypeOf('function')
    trigger?.()

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Finance Planner couldn't continue.")
  })
})
