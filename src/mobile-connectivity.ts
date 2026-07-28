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
    const url = new URL('/manifest.webmanifest', origin)
    url.searchParams.set('connectivity-check', String(Date.now()))
    const response = await fetcher(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { Accept: 'application/manifest+json, application/json;q=0.9, */*;q=0.1' },
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}
