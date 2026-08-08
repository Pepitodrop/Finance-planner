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
    // /health/live is the real, implemented app-health endpoint -- proxied
    // by vite.config.ts in dev/preview and served by the connector server
    // itself (server.js). /healthz is not a route this server implements
    // and is not in vite's proxy list either, so probing it here always
    // fails (a 404/SPA fallback, never real JSON), making this surface
    // permanently, incorrectly report "degraded" regardless of actual
    // connectivity. /healthz stays in sw.js's SENSITIVE_PATHS as a harmless
    // defensive exclusion (it doesn't need to exist to be excluded from
    // caching) but must not be the client's own connectivity signal.
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
