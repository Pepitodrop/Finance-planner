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
    const url = new URL('/health/live', origin)
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

export async function confirmServiceHealth(
  probe: () => Promise<boolean>,
  wait: (milliseconds: number) => Promise<unknown> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = 2,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await probe()) return true
    if (attempt < attempts - 1) await wait(350 * (attempt + 1))
  }
  return false
}
