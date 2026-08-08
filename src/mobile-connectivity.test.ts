import { describe, expect, it, vi } from 'vitest'
import { classifyConnectivity, confirmServiceHealth, probeSameOrigin } from './mobile-connectivity'

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
  it('uses the public same-origin health endpoint with credentialed no-store semantics', async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"ok"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

    await expect(probeSameOrigin(fetcher, 'https://planner.example')).resolves.toBe(true)
    expect(fetcher).toHaveBeenCalledOnce()

    const [url, options] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain('https://planner.example/health/live')
    expect(options).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
  })

  it('does not report degraded merely because bank providers are not configured', async () => {
    const fetcher = vi.fn(async () => new Response('{"status":"ok"}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

    const probeSucceeded = await probeSameOrigin(fetcher, 'https://planner.example')
    expect(classifyConnectivity({ navigatorOnline: true, probeSucceeded })).toBe('online')
  })

  it('fails closed on an invalid liveness payload', async () => {
    const fetcher = vi.fn(async () => new Response('<html>frontend fallback</html>', { status: 200 })) as unknown as typeof fetch
    await expect(probeSameOrigin(fetcher, 'https://planner.example')).resolves.toBe(false)
  })

  it('fails closed when the request errors', async () => {
    const fetcher = vi.fn(async () => { throw new Error('network unavailable') }) as unknown as typeof fetch
    await expect(probeSameOrigin(fetcher, 'https://planner.example')).resolves.toBe(false)
  })
})

describe('confirmServiceHealth', () => {
  it('does not promote one transient startup failure to a persistent outage', async () => {
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const wait = vi.fn().mockResolvedValue(undefined)
    await expect(confirmServiceHealth(probe, wait)).resolves.toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
  })

  it('reports an outage after the bounded confirmation attempts fail', async () => {
    const probe = vi.fn().mockResolvedValue(false)
    await expect(confirmServiceHealth(probe, async () => undefined)).resolves.toBe(false)
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
