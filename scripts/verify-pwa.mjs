import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8')

assert.equal(manifest.display, 'standalone')
assert.equal(manifest.start_url, '/')
assert.equal(manifest.scope, '/')
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must contain at least one icon')
assert.ok(manifest.icons.some((icon) => icon.purpose.includes('maskable')), 'manifest must provide a maskable icon')
assert.match(index, /rel="manifest"/)
assert.match(index, /apple-mobile-web-app-capable/)
assert.match(serviceWorker, /SENSITIVE_PATHS/)
assert.match(serviceWorker, /\/api\//)
assert.match(serviceWorker, /request\.mode === 'navigate'/)
assert.doesNotMatch(serviceWorker, /cache\.put\(event\.request/)

console.log('PWA policy verified')
