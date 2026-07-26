import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EncryptedStore } from '../src/crypto-store.js'

const secret = '0123456789abcdef0123456789abcdef'

test('credential store persists encrypted data and reloads it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-'))
  const path = join(directory, 'connectors.enc.json')
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.set('user-1', 'paypal', { accessToken: 'secret-token', lastSyncAt: '2026-07-26T00:00:00.000Z' })
    const raw = await readFile(path, 'utf8')
    assert.equal(raw.includes('secret-token'), false)
    const reopened = new EncryptedStore(path, secret)
    await reopened.load()
    assert.equal(reopened.get('user-1', 'paypal').accessToken, 'secret-token')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('wrong master key cannot decrypt the store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-'))
  const path = join(directory, 'connectors.enc.json')
  try {
    const store = new EncryptedStore(path, secret)
    await store.load()
    await store.set('user-1', 'gocardless', { requisitionId: 'req-1' })
    const wrong = new EncryptedStore(path, 'abcdef0123456789abcdef0123456789')
    await assert.rejects(() => wrong.load())
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
