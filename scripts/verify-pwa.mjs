import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')

assert.equal(manifest.display, 'standalone')
assert.ok(
  manifest.start_url === '/' || manifest.start_url.startsWith('/?'),
  'manifest start_url must stay within the application root',
)
assert.equal(manifest.scope, '/')
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must contain at least one icon')
assert.ok(manifest.icons.some((icon) => icon.purpose.includes('maskable')), 'manifest must provide a maskable icon')
assert.match(index, /rel="manifest"/)
assert.match(index, /apple-mobile-web-app-capable/)
assert.match(serviceWorker, /SENSITIVE_PATHS/)
assert.match(serviceWorker, /\/api\//)
assert.match(serviceWorker, /request\.mode === 'navigate'/)
assert.match(serviceWorker, /async function fetchWithTimeout\(request, timeoutMs\)/, 'Service-worker network requests must have a bounded timeout')
assert.match(serviceWorker, /\(await event\.preloadResponse\) \|\| await fetchWithTimeout\(request, NAVIGATION_TIMEOUT_MS\)/, 'Navigation preload must resolve before the bounded network fallback is selected')
assert.doesNotMatch(serviceWorker, /const response = event\.preloadResponse \|\|/, 'An unresolved preload promise must never bypass the navigation fetch fallback')
assert.doesNotMatch(serviceWorker, /cache\.put\(event\.request/)

console.log('PWA policy verified')
