import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EncryptedStore } from './crypto-store.js'

const secret = 'test-master-key-that-is-at-least-32-characters-long'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-store-'))
  return {
    directory,
    path: join(directory, 'connectors.enc.json'),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

test('encrypted store persists data and keeps a recoverable previous snapshot', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.set('user-1', 'paypal', { token: 'first' })
    await store.set('user-1', 'paypal', { token: 'second' })

    const primary = JSON.parse(await readFile(path, 'utf8'))
    const backup = JSON.parse(await readFile(`${path}.bak`, 'utf8'))
    assert.equal(primary.algorithm, 'AES-256-GCM')
    assert.equal(primary.version, 2)
    assert.equal(backup.algorithm, 'AES-256-GCM')

    await writeFile(path, '{corrupted', 'utf8')
    const recovered = new EncryptedStore(path, secret)
    await recovered.load()
    assert.deepEqual(recovered.get('user-1', 'paypal'), { token: 'first' })

    const reopened = new EncryptedStore(path, secret)
    await reopened.load()
    assert.deepEqual(reopened.get('user-1', 'paypal'), { token: 'first' })
  } finally {
    await cleanup()
  }
})

test('encrypted store removes every provider and OAuth nonce for one user', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.set('user-1', 'gocardless', { token: 'bank' })
    await store.set('user-1', 'licensed-aisp', { token: 'replacement' })
    await store.set('user-2', 'paypal', { token: 'other-user' })
    await store.registerOAuthNonce({
      nonce: 'user-1-nonce', consentId: 'consent-1', userId: 'user-1', provider: 'licensed-aisp',
      redirectUri: 'https://app.test/callback', expiresAt: Date.now() + 60_000,
    })
    await store.registerOAuthNonce({
      nonce: 'user-2-nonce', consentId: 'consent-2', userId: 'user-2', provider: 'paypal',
      redirectUri: 'https://app.test/callback', expiresAt: Date.now() + 60_000,
    })

    assert.deepEqual(await store.removeUser('user-1'), { connectorConnections: 2, oauthNonces: 1 })
    assert.equal(store.get('user-1', 'gocardless'), null)
    assert.equal(store.get('user-1', 'licensed-aisp'), null)
    assert.deepEqual(store.get('user-2', 'paypal'), { token: 'other-user' })
    assert.equal(await store.consumeOAuthNonce({
      nonce: 'user-1-nonce', consentId: 'consent-1', userId: 'user-1', provider: 'licensed-aisp',
      redirectUri: 'https://app.test/callback', now: Date.now(),
    }), false)
    assert.equal(await store.consumeOAuthNonce({
      nonce: 'user-2-nonce', consentId: 'consent-2', userId: 'user-2', provider: 'paypal',
      redirectUri: 'https://app.test/callback', now: Date.now(),
    }), true)

    const reopened = new EncryptedStore(path, secret)
    await reopened.load()
    assert.equal(reopened.get('user-1', 'licensed-aisp'), null)
    assert.deepEqual(reopened.get('user-2', 'paypal'), { token: 'other-user' })
  } finally {
    await cleanup()
  }
})

test('encrypted store rejects unsupported envelopes instead of accepting ambiguous data', async () => {
  const { path, cleanup } = await fixture()
  try {
    await writeFile(path, JSON.stringify({ format: 'other-store', version: 2 }), 'utf8')
    const store = new EncryptedStore(path, secret)
    await assert.rejects(store.load(), /could not be opened or recovered/)
  } finally {
    await cleanup()
  }
})
