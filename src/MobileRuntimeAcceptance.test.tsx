import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileRuntime } from './MobileRuntime'
import { RuntimeSurfaceCoordinator } from './runtime-surfaces/RuntimeSurfaceCoordinator'

// Step 14: install/iOS-guide (normally gated behind a real 30s delay and a
// real beforeinstallprompt event) and storage warning/critical/protection
// (normally driven by a real navigator.storage.estimate() result) can't be
// deterministically produced by a browser automation harness. This proves
// the acceptance-only override surface a browser acceptance script drives.
describe('MobileRuntime acceptance fixtures', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    delete (window as Window & { __financePlannerRuntimeAcceptanceState?: (mode: string) => void }).__financePlannerRuntimeAcceptanceState
  })

  function setMode(mode: string) {
    const target = window as Window & { __financePlannerRuntimeAcceptanceState?: (mode: string) => void }
    target.__financePlannerRuntimeAcceptanceState?.(mode)
  }

  it('never registers the fixture hook outside acceptance-fixture builds', () => {
    render(<RuntimeSurfaceCoordinator><MobileRuntime/></RuntimeSurfaceCoordinator>)
    expect((window as Window & { __financePlannerRuntimeAcceptanceState?: unknown }).__financePlannerRuntimeAcceptanceState).toBeUndefined()
  })

  it('shows the install card immediately under the install fixture, without the real 30s delay', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    render(<RuntimeSurfaceCoordinator><MobileRuntime/></RuntimeSurfaceCoordinator>)
    setMode('install')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Install Finance Planner' })).toBeInTheDocument())
  })

  it('shows the iOS add-to-home-screen guide under the ios-guide fixture', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    render(<RuntimeSurfaceCoordinator><MobileRuntime/></RuntimeSurfaceCoordinator>)
    setMode('ios-guide')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Add Finance Planner to your iPhone or iPad' })).toBeInTheDocument())
  })

  it('shows the storage-critical banner under the storage-critical fixture', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    render(<RuntimeSurfaceCoordinator><MobileRuntime/></RuntimeSurfaceCoordinator>)
    setMode('storage-critical')
    await waitFor(() => expect(screen.getByText('Device storage is almost full. Free up space to avoid failed local saves.')).toBeInTheDocument())
  })

  it('shows the storage-protection card under the storage-protection fixture', async () => {
    vi.stubEnv('VITE_ACCEPTANCE_FIXTURES', 'true')
    render(<RuntimeSurfaceCoordinator><MobileRuntime/></RuntimeSurfaceCoordinator>)
    setMode('storage-protection')
    await waitFor(() => expect(screen.getByRole('region', { name: 'Protect locally stored financial data' })).toBeInTheDocument())
  })
})
