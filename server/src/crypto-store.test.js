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

    assert.deepEqual(await store.removeUser('user-1'), { connectorConnections: 2, accountExclusions: 0, oauthNonces: 1 })
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

// Durable account-exclusion methods (2026-08-27, PR #154): found by
// independent review that the previous excludedStableAccountIds-inside-the-
// live-credential design lost the exclusion on disconnect/reconnect. These
// are deliberately independent of connections[userId][provider] -- remove()
// (disconnect) and removeUser() (account deletion) must have different
// blast radii.
const STABLE_ID_A = 'a'.repeat(64)
const STABLE_ID_B = 'b'.repeat(64)

test('addAccountExclusion persists independently of the connector connection and survives remove() (disconnect)', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.set('user-1', 'enablebanking', { sessionId: 'session-1' })
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_A, 'Savings account')

    // Disconnect: remove() deletes the connector credential row.
    await store.remove('user-1', 'enablebanking')
    assert.equal(store.get('user-1', 'enablebanking'), null)

    // The exclusion must survive disconnect -- this is the exact defect
    // found live and independently reviewed.
    const exclusions = await store.listAccountExclusions('user-1', 'enablebanking')
    assert.deepEqual(exclusions.map((e) => e.stableAccountId), [STABLE_ID_A])
    assert.equal(exclusions[0].accountName, 'Savings account')

    const reopened = new EncryptedStore(path, secret)
    await reopened.load()
    assert.deepEqual((await reopened.listAccountExclusions('user-1', 'enablebanking')).map((e) => e.stableAccountId), [STABLE_ID_A])
  } finally {
    await cleanup()
  }
})

test('addAccountExclusion is idempotent -- a duplicate add does not create a second entry', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_A, 'Checking')
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_A, 'Checking (renamed)')
    const exclusions = await store.listAccountExclusions('user-1', 'enablebanking')
    assert.equal(exclusions.length, 1)
  } finally {
    await cleanup()
  }
})

test('removeAccountExclusion (Restore) is idempotent and only removes the targeted exclusion', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_A, 'A')
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_B, 'B')
    await store.removeAccountExclusion('user-1', 'enablebanking', STABLE_ID_A)
    assert.deepEqual((await store.listAccountExclusions('user-1', 'enablebanking')).map((e) => e.stableAccountId), [STABLE_ID_B])
    // Removing again (e.g. a retried Restore click) is a no-op, not an error.
    await store.removeAccountExclusion('user-1', 'enablebanking', STABLE_ID_A)
    assert.deepEqual((await store.listAccountExclusions('user-1', 'enablebanking')).map((e) => e.stableAccountId), [STABLE_ID_B])
  } finally {
    await cleanup()
  }
})

test('account exclusions are user- and provider-isolated', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_A, 'A')
    await store.addAccountExclusion('user-2', 'enablebanking', STABLE_ID_A, 'Different user, same stable id')
    await store.addAccountExclusion('user-1', 'gocardless', STABLE_ID_A, 'Different provider, same user+stable id')
    assert.equal((await store.listAccountExclusions('user-1', 'enablebanking')).length, 1)
    assert.equal((await store.listAccountExclusions('user-2', 'enablebanking')).length, 1)
    assert.equal((await store.listAccountExclusions('user-1', 'gocardless')).length, 1)
    assert.equal((await store.listAccountExclusions('user-2', 'gocardless')).length, 0)
  } finally {
    await cleanup()
  }
})

test('rejects a malformed stable account id rather than silently persisting it', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await assert.rejects(store.addAccountExclusion('user-1', 'enablebanking', 'not-a-real-stable-id', 'X'))
  } finally {
    await cleanup()
  }
})

test('removeUser() clears every account exclusion for that user, not other users', async () => {
  const { path, cleanup } = await fixture()
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.addAccountExclusion('user-1', 'enablebanking', STABLE_ID_A, 'A')
    await store.addAccountExclusion('user-2', 'enablebanking', STABLE_ID_A, 'A')
    const deleted = await store.removeUser('user-1')
    assert.equal(deleted.accountExclusions, 1)
    assert.equal((await store.listAccountExclusions('user-1', 'enablebanking')).length, 0)
    assert.equal((await store.listAccountExclusions('user-2', 'enablebanking')).length, 1)
  } finally {
    await cleanup()
  }
})
