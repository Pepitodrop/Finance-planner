import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createAuthRouter } from '../src/auth-router.js'
import { createSession } from '../src/security.js'

const sessionSecret = 'test-session-secret-with-at-least-32-characters'
const authKey = 'test-auth-master-key-with-at-least-32-characters'

test('local auth session resolves to a provisioned auth user', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  try {
    let sent
    const send = (_response, status, payload, headers = {}) => {
      sent = { status, payload, headers }
    }
    const handleAuth = await createAuthRouter({
      env: {
        AUTH_MODE: 'local',
        AUTH_MASTER_KEY: authKey,
        AUTH_STORE_PATH: join(directory, 'auth.enc.json'),
        LOCAL_AUTH_EMAIL: 'developer@example.test',
        LOCAL_AUTH_NAME: 'Developer',
      },
      origin: 'http://localhost:5173',
      sessionSecret,
      send,
    })

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
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
