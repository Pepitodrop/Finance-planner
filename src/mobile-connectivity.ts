export type MobileConnectivity = 'online' | 'degraded' | 'offline'

export interface ConnectivitySnapshot {
  navigatorOnline: boolean
  probeSucceeded: boolean | null
}

export function classifyConnectivity(snapshot: ConnectivitySnapshot): MobileConnectivity {
  if (!snapshot.navigatorOnline) return 'offline'
  if (snapshot.probeSucceeded === false) return 'degraded'
  return 'online'
}

export async function probeSameOrigin(
  fetcher: typeof fetch,
  origin: string,
  timeoutMs = 5_000,
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = new URL('/healthz', origin)
    url.searchParams.set('connectivity-check', String(Date.now()))
    const response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return false
    const payload = await response.json().catch(() => null) as { status?: unknown } | null
    return payload?.status === 'ok'
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
