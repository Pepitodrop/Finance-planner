import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [manifestRaw, serviceWorker, index, main, mobileCss, mobileProductionCss, mobileRuntime, vaultGate, mobileSecurity] = await Promise.all([
  readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
  readFile(new URL('../public/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/mobile.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/mobile-production.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/MobileRuntime.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/VaultGate.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/mobile-security.ts', import.meta.url), 'utf8'),
])

const manifest = JSON.parse(manifestRaw)
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.orientation, 'portrait-primary')
assert.equal(manifest.lang, 'de-DE')
assert.equal(manifest.prefer_related_applications, false)
assert.ok(Array.isArray(manifest.icons) && manifest.icons.some((icon) => String(icon.purpose).includes('maskable')))
assert.ok(manifest.launch_handler?.client_mode?.includes('navigate-existing'))

assert.match(index, /viewport-fit=cover/)
assert.match(index, /interactive-widget=resizes-content/)
assert.match(index, /apple-mobile-web-app-capable/)
assert.match(index, /format-detection/)

assert.match(main, /MobileRuntime/)
assert.match(main, /mobile-production\.css/)
assert.match(main, /updateViaCache: 'none'/)
assert.match(mobileCss, /safe-area-inset-top/)
assert.match(mobileCss, /min-height: 44px/)
assert.match(mobileCss, /prefers-reduced-motion/)
assert.match(mobileCss, /mobile-privacy-shielded/)
assert.match(mobileProductionCss, /:focus-visible/)
assert.match(mobileProductionCss, /forced-colors/)
assert.match(mobileProductionCss, /orientation: landscape/)
assert.match(mobileRuntime, /isIOSDevice/)
assert.match(mobileRuntime, /Zum Home-Bildschirm/)
assert.match(mobileRuntime, /pagehide/)
assert.match(mobileRuntime, /mobile-privacy-shielded/)
assert.match(mobileRuntime, /UPDATE_INTERVAL_MS/)
assert.match(vaultGate, /visibilitychange/)
assert.match(vaultGate, /pagehide/)
assert.match(vaultGate, /shouldLockAfterBackground/)
assert.match(mobileSecurity, /MOBILE_BACKGROUND_LOCK_MS = 30_000/)
assert.match(mobileSecurity, /url\.origin !== origin/)

for (const path of ['/api/', '/connectors/', '/oauth/']) {
  assert.ok(serviceWorker.includes(path), `service worker must exclude sensitive path ${path}`)
}
assert.match(serviceWorker, /SKIP_WAITING/)
assert.match(serviceWorker, /navigationPreload/)
assert.match(serviceWorker, /MAX_RUNTIME_ENTRIES/)
assert.match(serviceWorker, /trimCache/)

console.log('Mobile production invariants verified.')
