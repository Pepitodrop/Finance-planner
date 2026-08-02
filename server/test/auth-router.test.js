import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createAuthRouter } from '../src/auth-router.js'
import { createSession } from '../src/security.js'

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
