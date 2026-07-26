const CACHE_NAME = 'finance-planner-shell-v2'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/app-icon.svg']
const SENSITIVE_PATHS = ['/api/', '/connectors/', '/oauth/', '/healthz']

function isSensitiveRequest(url) {
  return SENSITIVE_PATHS.some((path) => url.pathname === path.slice(0, -1) || url.pathname.startsWith(path))
}

function isStaticAsset(request, url) {
  return ['script', 'style', 'image', 'font', 'worker'].includes(request.destination)
    || url.pathname.startsWith('/assets/')
    || url.pathname.startsWith('/icons/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('finance-planner-') && key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || isSensitiveRequest(url)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', response.clone()))
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  if (!isStaticAsset(request, url)) return

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()))
        }
        return response
      })
      return cached ?? network
    }),
  )
})
