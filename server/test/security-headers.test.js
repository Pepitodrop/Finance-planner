import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Regression coverage for the narrow, deliberate CSP change (2026-08-22)
// that allows loading Enable Banking's official Auth Flow widget library --
// see src/features/connections/enableBankingWidgetLoader.ts and
// docs/OPEN_BANKING_ARCHITECTURE.md. Source-text assertions on the actual
// nginx config, not a re-implementation of the CSP parser, so this fails
// the moment the shipped header drifts from what was reviewed.

const conf = await readFile(new URL('../../deploy/security-headers.conf', import.meta.url), 'utf8')
const cspLine = conf.split('\n').find((line) => line.includes('Content-Security-Policy'))

test('auth.enablebanking.com is allowed only in script-src, as an addition (not a replacement)', () => {
  assert.ok(cspLine, 'Content-Security-Policy header line not found')
  const scriptSrc = cspLine.match(/script-src ([^;]+);/)?.[1]
  assert.ok(scriptSrc, 'script-src directive not found')
  assert.match(scriptSrc, /'self'/, 'must still allow self-hosted scripts')
  assert.match(scriptSrc, /'wasm-unsafe-eval'/, 'must not have dropped the existing wasm-unsafe-eval allowance')
  assert.match(scriptSrc, /https:\/\/auth\.enablebanking\.com/, 'must allow the official Auth Flow widget script host')
  // Exactly this one third-party host was added -- not a broad https: or
  // wildcard allowance that would defeat the point of an allowlist.
  assert.doesNotMatch(scriptSrc, /https:(?!\/\/auth\.enablebanking\.com)/, 'script-src must not have been broadened beyond the one named host')
  assert.doesNotMatch(scriptSrc, /\*/, 'script-src must not contain a wildcard')
})

test('frame-ancestors, object-src, and X-Frame-Options are unchanged -- no iframe permission was introduced', () => {
  assert.match(cspLine, /frame-ancestors 'none'/)
  assert.match(cspLine, /object-src 'none'/)
  assert.match(conf, /add_header X-Frame-Options DENY always;/)
})

test('connect-src is unchanged -- the existing https: allowance already covers the widget\'s own runtime network calls', () => {
  const connectSrc = cspLine.match(/connect-src ([^;]+);/)?.[1]
  assert.equal(connectSrc.trim(), "'self' https:")
})
