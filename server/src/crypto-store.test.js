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
