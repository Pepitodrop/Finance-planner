const SHELL_CACHE_NAME = 'finance-planner-shell-v6'
const RUNTIME_CACHE_NAME = 'finance-planner-runtime-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/app-icon.svg']
const SENSITIVE_PATHS = ['/api/', '/connectors/', '/oauth/', '/healthz']
const MAX_RUNTIME_ENTRIES = 80

function isSensitiveRequest(url) {
  return SENSITIVE_PATHS.some((path) => url.pathname === path.slice(0, -1) || url.pathname.startsWith(path))
}

function isVendorAsset(url) {
  return url.pathname.startsWith('/vendor/')
}

function isStaticAsset(request, url) {
  return ['script', 'style', 'image', 'font', 'worker'].includes(request.destination)
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
    || isVendorAsset(url)
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

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((key) => key.startsWith('finance-planner-')
        && key !== SHELL_CACHE_NAME
        && key !== RUNTIME_CACHE_NAME)
      .map((key) => caches.delete(key)))
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
      try {
        const response = event.preloadResponse || await fetch(request)
        if (response?.ok) {
          const shellCache = await caches.open(SHELL_CACHE_NAME)
          await shellCache.put('/index.html', response.clone())
        }
        return response
      } catch {
        const shellCache = await caches.open(SHELL_CACHE_NAME)
        return await shellCache.match('/index.html') || await shellCache.match('/') || Response.error()
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
        return await cacheRuntimeResponse(runtimeCache, request, await fetch(refreshedRequest))
      } catch {
        return await runtimeCache.match(request) || Response.error()
      }
    })())
    return
  }

  event.respondWith((async () => {
    const runtimeCache = await caches.open(RUNTIME_CACHE_NAME)
    const cached = await runtimeCache.match(request)
    const network = fetch(request)
      .then((response) => cacheRuntimeResponse(runtimeCache, request, response))
      .catch(() => undefined)

    if (cached) {
      event.waitUntil(network)
      return cached
    }

    return await network || Response.error()
  })())
})
