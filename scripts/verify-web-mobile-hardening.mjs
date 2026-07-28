import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = (path) => readFile(resolve(root, path), 'utf8')

const [main, hardening, css, worker] = await Promise.all([
  read('src/main.tsx'),
  read('src/WebMobileHardening.tsx'),
  read('src/web-mobile-hardening.css'),
  read('public/sw.js'),
])

assert.match(main, /<WebMobileHardening\s*\/>/, 'Runtime hardening layer must be mounted')
assert.match(main, /web-mobile-hardening\.css/, 'Hardening styles must be included')
assert.match(hardening, /href="#main-content"/, 'Keyboard users need a skip link')
assert.match(hardening, /aria-live="polite"/, 'Route changes need an accessible announcement')
assert.match(hardening, /prefers-color-scheme: dark/, 'Browser chrome must follow the system colour scheme')
assert.match(hardening, /MutationObserver/, 'Hardening must support delayed authenticated app mounting')
assert.match(css, /prefers-reduced-motion: reduce/, 'Reduced-motion preferences must be respected')
assert.match(css, /forced-colors: active/, 'High-contrast mode must remain usable')
assert.match(css, /min-height: 44px/, 'Coarse-pointer targets must meet the mobile minimum')
assert.match(worker, /SENSITIVE_PATHS/, 'Sensitive routes must remain outside service-worker caching')
assert.match(worker, /MAX_RUNTIME_ENTRIES/, 'Runtime caches must be bounded')
assert.match(worker, /\.catch\(\(\) => undefined\)/, 'Background revalidation must not create unhandled rejections')
assert.doesNotMatch(worker, /cache\.put\([^\n]*\/api\//, 'API responses must never be cached')

console.log('Web and mobile production-hardening gate passed.')
