import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AuthStore } from './auth-store.js'

const legacySecret = 'legacy-auth-encryption-secret-with-enough-length-123'
const primarySecret = 'primary-auth-encryption-secret-with-enough-length-456'

test('auth store re-encrypts a legacy file with the dedicated auth key', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'finance-planner-auth-'))
  const path = join(directory, 'auth.enc.json')
  try {
    const legacyStore = new AuthStore(path, legacySecret, null)
    await legacyStore.load()
    await legacyStore.mutate((data) => {
      data.users['google:test'] = { id: 'google:test', email: 'test@example.com', name: 'Test', passkeys: [] }
    })
    const legacyEnvelope = await readFile(path, 'utf8')

    const migratedStore = new AuthStore(path, primarySecret, null, legacySecret)
    await migratedStore.load()
    assert.equal(migratedStore.findByEmail('test@example.com')?.id, 'google:test')
    const migratedEnvelope = await readFile(path, 'utf8')
    assert.notEqual(migratedEnvelope, legacyEnvelope)

    const primaryOnlyStore = new AuthStore(path, primarySecret, null)
    await primaryOnlyStore.load()
    assert.equal(primaryOnlyStore.findByEmail('test@example.com')?.id, 'google:test')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
