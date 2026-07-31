import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = (path) => readFile(resolve(root, path), 'utf8')

const [main, bootstrap, hardening, css, worker] = await Promise.all([
  read('src/main.tsx'),
  read('src/app/bootstrap.tsx'),
  read('src/WebMobileHardening.tsx'),
  read('src/web-mobile-hardening.css'),
  read('public/sw.js'),
])
const entry = `${main}\n${bootstrap}`

assert.match(main, /app\/bootstrap/, 'The root entrypoint must delegate to the app bootstrap')
assert.match(entry, /<WebMobileHardening\s*\/>/, 'Runtime hardening layer must be mounted')
assert.match(entry, /web-mobile-hardening\.css/, 'Hardening styles must be included')
assert.match(hardening, /href="#main-content"/, 'Keyboard users need a skip link')
assert.match(hardening, /aria-live="polite"/, 'Route changes need an accessible announcement')
assert.match(hardening, /prefers-color-scheme: dark/, 'Browser chrome must follow the system colour scheme')
assert.match(hardening, /MutationObserver/, 'Hardening must support delayed authenticated app mounting')
assert.match(css, /prefers-reduced-motion: reduce/, 'Reduced-motion preferences must be respected')
assert.match(css, /forced-colors: active/, 'High-contrast mode must remain usable')
assert.match(css, /min-height: 44px/, 'Coarse-pointer targets must meet the mobile minimum')
assert.match(worker, /SENSITIVE_PATHS/, 'Sensitive routes must remain outside service-worker caching')
assert.match(worker, /MAX_RUNTIME_ENTRIES/, 'Runtime caches must be bounded')
assert.match(worker, /SHELL_CACHE_NAME/, 'The immutable app shell needs a dedicated cache')
assert.match(worker, /RUNTIME_CACHE_NAME/, 'Runtime assets need a separate bounded cache')
assert.match(worker, /caches\.open\(SHELL_CACHE_NAME\).*cache\.addAll\(APP_SHELL\)/s, 'App shell must be installed only into the protected shell cache')
assert.match(worker, /caches\.open\(RUNTIME_CACHE_NAME\)/, 'Runtime responses must use the runtime cache')
assert.match(worker, /trimRuntimeCache\(runtimeCache\)/, 'Only the runtime cache may be trimmed')
assert.doesNotMatch(worker, /trimRuntimeCache\(shellCache\)/, 'The protected app shell must never be trimmed')
assert.match(worker, /\.catch\(\(\) => undefined\)/, 'Background revalidation must not create unhandled rejections')
assert.doesNotMatch(worker, /cache\.put\([^\n]*\/api\//, 'API responses must never be cached')

console.log('Web and mobile production-hardening gate passed.')
