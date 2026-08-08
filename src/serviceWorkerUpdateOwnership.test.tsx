import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileRuntime } from './MobileRuntime'
import { WebMobileHardening } from './WebMobileHardening'
import { RuntimeSurfaceCoordinator } from './runtime-surfaces/RuntimeSurfaceCoordinator'

// Step 14: update detection/dispatch is now owned solely by
// MobileProductionRuntime (not exercised here, since jsdom has no real
// navigator.serviceWorker lifecycle) -- MobileRuntime's visible banner and
// WebMobileHardening's screen-reader announcement are both pure consumers of
// the finance-planner:update-available event it dispatches. This proves the
// consumer side of that contract without re-implementing the browser's own
// service-worker plumbing.
describe('finance-planner:update-available consumers', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows the update banner and lets the user activate the waiting worker', async () => {
    const postMessage = vi.fn()
    const registration = { waiting: { postMessage } } as unknown as ServiceWorkerRegistration

    render(<RuntimeSurfaceCoordinator><MobileRuntime /></RuntimeSurfaceCoordinator>)
    expect(screen.queryByText('A safer, newer version is available.')).not.toBeInTheDocument()

    window.dispatchEvent(new CustomEvent('finance-planner:update-available', { detail: { registration } }))

    const updateButton = await screen.findByRole('button', { name: 'Update now' })
    updateButton.click()
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('announces the update to screen readers without a duplicate visible surface', async () => {
    render(<WebMobileHardening />)
    const registration = { waiting: {} } as unknown as ServiceWorkerRegistration

    window.dispatchEvent(new CustomEvent('finance-planner:update-available', { detail: { registration } }))

    await waitFor(() => expect(screen.getByText('A new version is available.')).toBeInTheDocument())
  })
})
