import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createAuthRouter } from '../src/auth-router.js'
import { createSession, verifySession } from '../src/security.js'

const sessionSecret = 'test-session-secret-with-at-least-32-characters'
const authKey = 'test-auth-master-key-with-at-least-32-characters'

async function createLocalRouter(directory, send, overrides = {}) {
  return createAuthRouter({
    env: {
      AUTH_MODE: 'local',
      AUTH_MASTER_KEY: authKey,
      AUTH_STORE_PATH: join(directory, 'auth.enc.json'),
      LOCAL_AUTH_EMAIL: 'developer@example.test',
      LOCAL_AUTH_NAME: 'Developer',
      ...overrides,
    },
    origin: 'http://localhost:5173',
    sessionSecret,
    send,
  })
}

function jsonRequest(method, payload) {
  const request = Readable.from([Buffer.from(JSON.stringify(payload))])
  request.method = method
  request.headers = { 'content-type': 'application/json' }
  return request
}

test('local auth session resolves to a provisioned auth user and refreshes the persistent cookie', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => { sent = { status, payload, headers } }
    const handleAuth = await createLocalRouter(directory, send, { SESSION_TTL_SECONDS: '2592000' })
    const token = createSession('local-user', sessionSecret, 86400)
    const handled = await handleAuth(
      { method: 'GET', headers: { cookie: `fp_session=${encodeURIComponent(token)}` } },
      {},
      new URL('http://localhost:5173/api/auth/session'),
    )

    assert.equal(handled, true)
    assert.equal(sent.status, 200)
    assert.deepEqual(sent.payload, {
      authenticated: true,
      user: {
        id: 'local-user',
        email: 'developer@example.test',
        name: 'Developer',
        picture: undefined,
        passkeyCount: 0,
      },
    })
    assert.match(sent.headers['Set-Cookie'], /^fp_session=/)
    assert.match(sent.headers['Set-Cookie'], /Max-Age=2592000/)
    assert.match(sent.headers['Set-Cookie'], /HttpOnly/)
    assert.match(sent.headers['Set-Cookie'], /SameSite=Lax/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('an invalid reload cookie returns an unauthenticated session instead of failing the request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => { sent = { status, payload, headers } }
    const handleAuth = await createLocalRouter(directory, send)
    const handled = await handleAuth(
      { method: 'GET', headers: { cookie: 'fp_session=invalid-cookie' } },
      {},
      new URL('http://localhost:5173/api/auth/session'),
    )

    assert.equal(handled, true)
    assert.equal(sent.status, 200)
    assert.deepEqual(sent.payload, { authenticated: false, user: null })
    assert.deepEqual(sent.headers, {})
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('passkey authenticate options returns generic options for an unregistered email instead of erroring', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => {
      sent = { status, payload, headers }
    }
    const handleAuth = await createAuthRouter({
      env: {
        AUTH_MASTER_KEY: authKey,
        AUTH_STORE_PATH: join(directory, 'auth.enc.json'),
      },
      origin: 'http://localhost:5173',
      sessionSecret,
      send,
    })

    const handled = await handleAuth(
      jsonRequest('POST', { email: 'no-such-user@example.test' }),
      {},
      new URL('http://localhost:5173/api/auth/passkeys/authenticate/options'),
    )

    assert.equal(handled, true)
    assert.equal(sent.status, 200)
    assert.equal(sent.payload.allowCredentials, undefined)
    assert.ok(sent.payload.challenge)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('google login start redirects to a valid Google authorization URL with state and nonce cookies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    const send = () => {
      throw new Error('send() should not be called for a redirect response')
    }
    const handleAuth = await createAuthRouter({
      env: {
        AUTH_MASTER_KEY: authKey,
        AUTH_STORE_PATH: join(directory, 'auth.enc.json'),
        GOOGLE_CLIENT_ID: 'test-google-client-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      },
      origin: 'http://localhost:5173',
      sessionSecret,
      send,
    })

    let head
    const response = {
      writeHead: (status, headers) => { head = { status, headers } },
      end: () => {},
    }
    const handled = await handleAuth(
      { method: 'GET', headers: {} },
      response,
      new URL('http://localhost:5173/api/auth/google/start'),
    )

    assert.equal(handled, true)
    assert.equal(head.status, 302)
    const redirectUrl = new URL(head.headers.Location)
    assert.equal(redirectUrl.hostname, 'accounts.google.com')
    assert.equal(redirectUrl.searchParams.get('client_id'), 'test-google-client-id.apps.googleusercontent.com')
    assert.equal(redirectUrl.searchParams.get('redirect_uri'), 'http://localhost:5173/api/auth/google/callback')
    assert.deepEqual(new Set(redirectUrl.searchParams.get('scope').split(' ')), new Set(['openid', 'email', 'profile']))
    assert.ok(redirectUrl.searchParams.get('state'))
    assert.ok(redirectUrl.searchParams.get('nonce'))

    const setCookies = head.headers['Set-Cookie']
    assert.ok(setCookies.some((c) => c.startsWith('fp_google_state=')))
    assert.ok(setCookies.some((c) => c.startsWith('fp_google_nonce=')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function timeRequest(handleAuth, request, url) {
  const send = () => {}
  const start = process.hrtime.bigint()
  await handleAuth(request, {}, url).catch(() => {})
  return Number(process.hrtime.bigint() - start) / 1_000_000
}

test('SECURITY: password login takes comparable time for an unknown email as for a wrong password, not a fast-path short-circuit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => { sent = { status, payload, headers } }
    const handleAuth = await createAuthRouter({
      env: { AUTH_MASTER_KEY: authKey, AUTH_STORE_PATH: join(directory, 'auth.enc.json') },
      origin: 'http://localhost:5173',
      sessionSecret,
      send,
    })

    // Register a real user so "known email, wrong password" has an actual
    // scrypt hash to verify against.
    const registered = await handleAuth(
      jsonRequest('POST', { name: 'Timing Test', email: 'timing-test@example.test', password: 'CorrectPassword123!' }),
      {},
      new URL('http://localhost:5173/api/auth/password/register'),
    )
    assert.equal(registered, true)
    assert.equal(sent.status, 200)

    const SAMPLES = 6
    const knownWrongPasswordTimes = []
    const unknownEmailTimes = []
    for (let i = 0; i < SAMPLES; i++) {
      knownWrongPasswordTimes.push(await timeRequest(
        handleAuth,
        jsonRequest('POST', { email: 'timing-test@example.test', password: 'DefinitelyWrongPassword123!' }),
        new URL('http://localhost:5173/api/auth/password/login'),
      ))
      unknownEmailTimes.push(await timeRequest(
        handleAuth,
        jsonRequest('POST', { email: `no-such-user-${i}@example.test`, password: 'DefinitelyWrongPassword123!' }),
        new URL('http://localhost:5173/api/auth/password/login'),
      ))
    }

    const knownMedian = median(knownWrongPasswordTimes)
    const unknownMedian = median(unknownEmailTimes)
    // Before the fix this ratio was ~0.06 (unknown-email responses were
    // ~16x faster because verifyPassword's scrypt call was skipped entirely
    // for a nonexistent user). A generous 0.25 floor catches a regression
    // back to that short-circuit while tolerating normal test-env jitter.
    assert.ok(
      unknownMedian >= knownMedian * 0.25,
      `unknown-email login (median ${unknownMedian.toFixed(1)}ms) must not be dramatically faster than known-user wrong-password login (median ${knownMedian.toFixed(1)}ms) -- a large gap re-enables email enumeration via timing`,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('SECURITY: logout revokes the session server-side, not just the browser cookie', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => { sent = { status, payload, headers } }
    const revoked = []
    const handleAuth = await createAuthRouter({
      env: { AUTH_MASTER_KEY: authKey, AUTH_STORE_PATH: join(directory, 'auth.enc.json') },
      origin: 'http://localhost:5173',
      sessionSecret,
      send,
      verifyActiveSession: (token) => {
        const sessionUserId = verifySession(token, sessionSecret)
        if (revoked.includes(sessionUserId)) throw new Error('Session revoked.')
        return sessionUserId
      },
      revokeSession: async (userId) => { revoked.push(userId) },
    })

    const registered = await handleAuth(
      jsonRequest('POST', { name: 'Logout Test', email: 'logout-test@example.test', password: 'CorrectPassword123!' }),
      {},
      new URL('http://localhost:5173/api/auth/password/register'),
    )
    assert.equal(registered, true)
    const userId = sent.payload.user.id
    const setCookie = sent.headers['Set-Cookie']
    const token = decodeURIComponent(setCookie.match(/fp_session=([^;]+)/)[1])

    const loggedOut = await handleAuth(
      { method: 'POST', headers: { cookie: `fp_session=${encodeURIComponent(token)}` } },
      {},
      new URL('http://localhost:5173/api/auth/logout'),
    )
    assert.equal(loggedOut, true)
    assert.equal(sent.status, 200)
    assert.deepEqual(revoked, [userId], 'logout must revoke the acting session server-side, not merely clear the cookie')

    // The same token, presented again as if it had been stolen before logout,
    // must now be rejected -- not merely absent from the logging-out browser.
    const staleReuse = await handleAuth(
      { method: 'GET', headers: { cookie: `fp_session=${encodeURIComponent(token)}` } },
      {},
      new URL('http://localhost:5173/api/auth/session'),
    )
    assert.equal(staleReuse, true)
    assert.deepEqual(sent.payload, { authenticated: false, user: null }, 'a session token revoked at logout must not still authenticate a request')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('logout without an active session still succeeds and never calls revokeSession', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => { sent = { status, payload, headers } }
    let revokeCalls = 0
    const handleAuth = await createAuthRouter({
      env: { AUTH_MASTER_KEY: authKey, AUTH_STORE_PATH: join(directory, 'auth.enc.json') },
      origin: 'http://localhost:5173',
      sessionSecret,
      send,
      revokeSession: async () => { revokeCalls += 1 },
    })

    const handled = await handleAuth({ method: 'POST', headers: {} }, {}, new URL('http://localhost:5173/api/auth/logout'))
    assert.equal(handled, true)
    assert.equal(sent.status, 200)
    assert.equal(revokeCalls, 0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
