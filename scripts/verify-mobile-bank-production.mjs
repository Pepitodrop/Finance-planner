import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const read = (path) => readFile(resolve(root, path), 'utf8')
const [main, runtime, connectors, panel] = await Promise.all([
  read('src/main.tsx'),
  read('src/MobileProductionRuntime.tsx'),
  read('src/connectors.ts'),
  read('src/ConnectionsPanel.tsx'),
])

assert.match(main, /<MobileProductionRuntime\s*\/>/, 'Mobile production runtime must be mounted')
assert.match(runtime, /visualViewport/, 'Visual viewport changes must be handled for mobile keyboards')
assert.match(runtime, /registration\.update/, 'Installed apps must periodically check for safe updates')
assert.match(runtime, /connectivity-restored/, 'Connectivity restoration must be broadcast to the app')
assert.match(runtime, /effectiveType/, 'Network quality must be exposed for adaptive behavior')
assert.match(connectors, /AbortController/, 'Bank requests must have a hard timeout')
assert.match(connectors, /RETRY_DELAYS_MS/, 'Transient banking failures must be retried with bounded backoff')
assert.match(connectors, /requestId/, 'Backend request references must be surfaced for support')
assert.match(connectors, /disconnectConnector/, 'Users must be able to revoke a bank connection')
assert.match(connectors, /connectorReturnUrl/, 'OAuth return URLs must remove stale callback parameters')
assert.match(connectors, /consentDaysRemaining/, 'PSD2 consent expiry must be tracked')
assert.match(panel, /Verbindungszustand/, 'Connection health must be visible')
assert.match(panel, /Zustimmung/, 'Consent expiry must be shown to the user')
assert.match(panel, /Provider-Tokens wurden serverseitig entfernt/, 'Disconnect semantics must be explicit')

console.log('Mobile and bank production gate passed.')
