import { describe, expect, it, vi } from 'vitest'
import { classifyConnectivity, probeSameOrigin } from './mobile-connectivity'

describe('classifyConnectivity', () => {
  it('reports offline when the browser reports no network', () => {
    expect(classifyConnectivity({ navigatorOnline: false, probeSucceeded: true })).toBe('offline')
  })

  it('reports degraded when the device is online but the app is unreachable', () => {
    expect(classifyConnectivity({ navigatorOnline: true, probeSucceeded: false })).toBe('degraded')
  })

  it('reports online before and after a successful probe', () => {
    expect(classifyConnectivity({ navigatorOnline: true, probeSucceeded: null })).toBe('online')
    expect(classifyConnectivity({ navigatorOnline: true, probeSucceeded: true })).toBe('online')
  })
})

describe('probeSameOrigin', () => {
  it('uses a same-origin, credentialed, no-store request', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch

    await expect(probeSameOrigin(fetcher, 'https://planner.example')).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()

    const [url, options] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain('https://planner.example/manifest.webmanifest')
    expect(options).toMatchObject({ cache: 'no-store', credentials: 'same-origin', method: 'GET' })
  })

  it('fails closed when the request errors', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network unavailable') }) as unknown as typeof fetch
    await expect(probeSameOrigin(fetcher, 'https://planner.example')).resolves.toBe(false)
  })
})
