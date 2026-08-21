import test from 'node:test'
import assert from 'node:assert/strict'
import { HttpError, SlidingWindowRateLimiter, classifyError, clientIp, rateLimitTier, requestId, validateProductionConfig } from './runtime-security.js'

// Regression coverage for a live production defect (2026-08-21): logo
// requests were classified under the same "sensitive" bucket as POST
// /start/sync/disconnect, so a normal user browsing a real bank directory
// could starve those genuinely security-sensitive operations. The logo
// route must resolve to its own 'asset' tier, checked BEFORE the generic
// /api/connectors/ prefix match so it can never fall through to 'sensitive'.
test('rateLimitTier classifies the institution-logo route as its own asset tier, not sensitive', () => {
  assert.equal(rateLimitTier('/api/connectors/enablebanking/logo'), 'asset')
  assert.equal(rateLimitTier('/api/connectors/gocardless/logo'), 'asset')
})

test('rateLimitTier still classifies every other /api/connectors/ route as sensitive', () => {
  assert.equal(rateLimitTier('/api/connectors/enablebanking/start'), 'sensitive')
  assert.equal(rateLimitTier('/api/connectors/enablebanking/institutions'), 'sensitive')
  assert.equal(rateLimitTier('/api/connectors/sync'), 'sensitive')
  assert.equal(rateLimitTier('/api/connectors/enablebanking'), 'sensitive') // DELETE (disconnect)
  assert.equal(rateLimitTier('/api/connectors'), 'sensitive')
  assert.equal(rateLimitTier('/api/connectors/callback'), 'sensitive')
  assert.equal(rateLimitTier('/api/auth/session'), 'sensitive')
  assert.equal(rateLimitTier('/api/session/local'), 'sensitive')
})

test('rateLimitTier does not misclassify a path that merely contains "logo" elsewhere, or a lookalike path', () => {
  assert.equal(rateLimitTier('/api/connectors/enablebanking/logo/../start'), 'sensitive') // does not end in exactly /logo
  assert.equal(rateLimitTier('/api/connectors/enablebanking/logotype'), 'sensitive')
  assert.equal(rateLimitTier('/api/logo'), 'general') // not under /api/connectors/ at all
})

// A security review (2026-08-21) flagged that, before this exclusion, a
// literal /api/connectors/webhooks/logo path would satisfy LOGO_ROUTE_PATTERN
// (webhooks looks like any other provider-id segment) and fall into the
// permissive asset tier, even though it's also shaped like the webhook
// dispatch route (/api/connectors/webhooks/:provider). Inert in practice --
// no provider is ever registered as "logo" -- but the two route families
// must not overlap regardless.
test('rateLimitTier never classifies a path under /api/connectors/webhooks/ as the asset tier', () => {
  assert.equal(rateLimitTier('/api/connectors/webhooks/logo'), 'sensitive')
  assert.equal(rateLimitTier('/api/connectors/webhooks/gocardless'), 'sensitive')
})

test('rateLimitTier classifies unrelated routes as general', () => {
  assert.equal(rateLimitTier('/health'), 'general')
  assert.equal(rateLimitTier('/api/backup/export'), 'general')
})

// End-to-end shape of the live production defect and its fix: simulates
// server.js's actual per-request dispatch (rateLimitTier() picks the
// limiter, that limiter's own bucket is consumed) using the real exported
// pieces, without importing server.js itself (which starts a real listener
// as a side effect of import -- see the rest of this test suite's
// convention). Before the fix, a single shared "sensitive" limiter meant
// this exact sequence would have left POST /start with zero remaining
// quota after well under 50 logo requests.
test('many logo requests never exhaust the sensitive bucket that POST /start/sync/disconnect depend on', () => {
  const limiters = {
    asset: new SlidingWindowRateLimiter({ limit: 240, windowMs: 60_000 }),
    sensitive: new SlidingWindowRateLimiter({ limit: 20, windowMs: 60_000 }),
    general: new SlidingWindowRateLimiter({ limit: 120, windowMs: 60_000 }),
  }
  const dispatch = (pathname, now) => limiters[rateLimitTier(pathname)].consume('same-client', now)

  // A real bank directory easily produces more logo requests than the
  // sensitive bucket's entire per-minute allowance.
  for (let index = 0; index < 50; index += 1) {
    const result = dispatch('/api/connectors/enablebanking/logo', index * 100)
    assert.equal(result.allowed, true, `logo request ${index} should never be blocked by this volume`)
  }

  // /start, for the SAME client, in the SAME window, must still be allowed
  // -- proving the two tiers are genuinely independent, not just labeled
  // differently while sharing state.
  const startResult = dispatch('/api/connectors/enablebanking/start', 5_000)
  assert.equal(startResult.allowed, true)
  assert.equal(startResult.remaining, 19) // the sensitive bucket was never touched by the logo traffic

  // The sensitive tier itself still genuinely protects /start: exhaust it
  // directly and confirm the 21st sensitive request is blocked.
  for (let index = 0; index < 19; index += 1) dispatch('/api/connectors/enablebanking/start', 6_000 + index)
  const blocked = dispatch('/api/connectors/enablebanking/start', 7_000)
  assert.equal(blocked.allowed, false)

  // Logo traffic itself is still genuinely rate-limited, not unlimited --
  // abusive volume against the asset tier still gets a 429 eventually.
  for (let index = 50; index < 240; index += 1) dispatch('/api/connectors/enablebanking/logo', 8_000 + index)
  const abusiveLogo = dispatch('/api/connectors/enablebanking/logo', 9_000)
  assert.equal(abusiveLogo.allowed, false)
})

test('clientIp prefers X-Real-IP (nginx-set, not client-forgeable) over X-Forwarded-For', () => {
  assert.equal(clientIp({ headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '10.0.0.1, 203.0.113.9' } }), '203.0.113.9')
})

test('clientIp falls back to X-Forwarded-For when X-Real-IP is absent (e.g. no proxy in front)', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' } }), '203.0.113.9')
})

test('clientIp falls back to the raw socket address when no proxy headers are present', () => {
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '198.51.100.1' } }), '198.51.100.1')
})

test('requestId accepts safe values and replaces unsafe input', () => {
  assert.equal(requestId({ 'x-request-id': 'request-1234' }), 'request-1234')
  assert.match(requestId({ 'x-request-id': '<script>' }), /^[0-9a-f-]{36}$/)
})

test('rate limiter blocks requests over the configured window limit', () => {
  const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 1000 })
  assert.equal(limiter.consume('client', 0).allowed, true)
  assert.equal(limiter.consume('client', 1).allowed, true)
  assert.equal(limiter.consume('client', 2).allowed, false)
  assert.equal(limiter.consume('client', 1001).allowed, true)
})

test('classifyError returns stable public error responses', () => {
  assert.deepEqual(classifyError(new HttpError(415, 'unsupported_media_type', 'JSON required.')), {
    status: 415,
    code: 'unsupported_media_type',
    message: 'JSON required.',
  })
  assert.equal(classifyError(new Error('Invalid session.')).status, 401)
  assert.equal(classifyError(new Error('Session revoked.')).status, 401)
  assert.equal(classifyError(new Error('Request body too large.')).status, 413)
})

test('classifyError hides unexpected exception details behind a 500 response', () => {
  assert.deepEqual(classifyError(new Error('provider secret leaked in stack message')), {
    status: 500,
    code: 'internal_error',
    message: 'Internal server error.',
  })
  assert.deepEqual(classifyError('raw upstream failure'), {
    status: 500,
    code: 'internal_error',
    message: 'Internal server error.',
  })
})

test('public production configuration requires HTTPS, PostgreSQL, trusted proxy and metrics authentication', () => {
  const publicProduction = {
    NODE_ENV: 'production',
    PUBLIC_DEPLOYMENT: 'true',
    AUTH_MODE: 'google',
    CONNECTOR_STORE_DRIVER: 'postgres',
    TRUST_PROXY: 'true',
    METRICS_TOKEN: 'production-metrics-token-with-more-than-32-characters',
  }
  assert.throws(() => validateProductionConfig({ ...publicProduction, AUTH_MODE: 'local' }, 'https://app.example'), /AUTH_MODE/)
  assert.throws(() => validateProductionConfig(publicProduction, 'http://app.example'), /HTTPS/)
  assert.throws(() => validateProductionConfig({ ...publicProduction, CONNECTOR_STORE_DRIVER: 'file' }, 'https://app.example'), /postgres/)
  assert.throws(() => validateProductionConfig({ ...publicProduction, TRUST_PROXY: 'false' }, 'https://app.example'), /TRUST_PROXY/)
  assert.throws(() => validateProductionConfig({ ...publicProduction, METRICS_TOKEN: 'too-short' }, 'https://app.example'), /METRICS_TOKEN/)
  assert.doesNotThrow(() => validateProductionConfig(publicProduction, 'https://app.example'))
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'development', PUBLIC_DEPLOYMENT: 'true', AUTH_MODE: 'local' }, 'http://localhost:5173'))
})

test('AUTH_MODE=local is rejected whenever NODE_ENV=production, even without PUBLIC_DEPLOYMENT', () => {
  assert.throws(() => validateProductionConfig({ NODE_ENV: 'production', AUTH_MODE: 'local' }, 'http://localhost:8080'), /AUTH_MODE/)
  assert.throws(() => validateProductionConfig({ NODE_ENV: 'production', PUBLIC_DEPLOYMENT: 'false', AUTH_MODE: 'local' }, 'http://localhost:8080'), /AUTH_MODE/)
  assert.doesNotThrow(() => validateProductionConfig({ NODE_ENV: 'production', AUTH_MODE: 'google' }, 'http://localhost:8080'))
})
