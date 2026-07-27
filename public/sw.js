const CACHE_NAME = 'finance-planner-shell-v4'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/app-icon.svg']
const SENSITIVE_PATHS = ['/api/', '/connectors/', '/oauth/', '/healthz']
const MAX_RUNTIME_ENTRIES = 80

function isSensitiveRequest(url) {
  return SENSITIVE_PATHS.some((path) => url.pathname === path.slice(0, -1) || url.pathname.startsWith(path))
}

function isStaticAsset(request, url) {
  return ['script', 'style', 'image', 'font', 'worker'].includes(request.destination)
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
}

async function trimCache(cache) {
  const keys = await cache.keys()
  if (keys.length <= MAX_RUNTIME_ENTRIES) return
  await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME_ENTRIES).map((key) => cache.delete(key)))
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter((key) => key.startsWith('finance-planner-') && key !== CACHE_NAME)
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
        const response = await event.preloadResponse || await fetch(request)
        if (response?.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put('/index.html', response.clone())
        }
        return response
      } catch {
        return await caches.match('/index.html') || new Response('Finance Planner ist offline nicht verfügbar.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    })())
    return
  }

  if (!isStaticAsset(request, url)) return

  event.respondWith((async () => {
    const cached = await caches.match(request)
    const network = fetch(request).then(async (response) => {
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_NAME)
        await cache.put(request, response.clone())
        await trimCache(cache)
      }
      return response
    }).catch(() => cached || Response.error())
    return cached || network
  })())
})
