const SHELL_CACHE_NAME = 'finance-planner-shell-v7'
const RUNTIME_CACHE_NAME = 'finance-planner-runtime-v3'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/app-icon.svg']
const SENSITIVE_PATHS = ['/api/', '/connectors/', '/oauth/', '/healthz']
const MAX_RUNTIME_ENTRIES = 80
const NAVIGATION_TIMEOUT_MS = 4500

function isSensitiveRequest(url) {
  return SENSITIVE_PATHS.some((path) => url.pathname === path.slice(0, -1) || url.pathname.startsWith(path))
}
function isVendorAsset(url) { return url.pathname.startsWith('/vendor/') }
function isStaticAsset(request, url) {
  return ['script', 'style', 'image', 'font', 'worker'].includes(request.destination)
    || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || isVendorAsset(url)
}
async function trimRuntimeCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_RUNTIME_ENTRIES) return
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key)))
}
async function cacheRuntimeResponse(runtimeCache, request, response) {
  if (response.ok && response.type === 'basic') {
    await runtimeCache.put(request, response.clone())
    await trimRuntimeCache(runtimeCache)
  }
  return response
}
async function fetchWithTimeout(request, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(request, { signal: controller.signal }) }
  finally { clearTimeout(timer) }
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
})
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith('finance-planner-') && key !== SHELL_CACHE_NAME && key !== RUNTIME_CACHE_NAME).map((key) => caches.delete(key)))
    if ('navigationPreload' in self.registration) await self.registration.navigationPreload.enable()
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isSensitiveRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const shellCache = await caches.open(SHELL_CACHE_NAME)
      try {
        const response = (await event.preloadResponse) || await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)
        if (response?.ok) await shellCache.put('/index.html', response.clone())
        return response
      } catch {
        return await shellCache.match('/index.html') || await shellCache.match('/') || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' } })
      }
    })())
    return
  }

  if (!isStaticAsset(request, url)) return
  if (isVendorAsset(url)) {
    event.respondWith((async () => {
      const runtimeCache = await caches.open(RUNTIME_CACHE_NAME)
      try {
        const refreshedRequest = new Request(request, { cache: 'reload' })
        return await cacheRuntimeResponse(runtimeCache, request, await fetchWithTimeout(refreshedRequest, NAVIGATION_TIMEOUT_MS))
      } catch {
        return await runtimeCache.match(request) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const runtimeCache = await caches.open(RUNTIME_CACHE_NAME)
    const cached = await runtimeCache.match(request)
    const network = fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS)
      .then((response) => cacheRuntimeResponse(runtimeCache, request, response))
      .catch(() => undefined)
    if (cached) {
      event.waitUntil(network)
      return cached
    }
    return await network || Response.error()
  })())
})
