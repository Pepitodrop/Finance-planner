import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileConnectivityStatus } from './MobileConnectivityStatus'
import { RuntimeSurfaceCoordinator } from './runtime-surfaces/RuntimeSurfaceCoordinator'

describe('MobileConnectivityStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('confirms an outage, performs a genuine Retry, and clears after recovery', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()

    render(<RuntimeSurfaceCoordinator><MobileConnectivityStatus/></RuntimeSurfaceCoordinator>)
    const retry = await screen.findByRole('button', { name: 'Retry' }, { timeout: 2_000 })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await user.click(retry)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
