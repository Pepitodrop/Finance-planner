import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeTestAccountEmail,
  provisionTestAccount,
  requireTestAccountName,
  testAccountUserId,
  verifyProvisionedTestAccount,
} from '../src/test-account-provisioning.js'

class MemoryAuthStore {
  constructor(shared) {
    this.shared = shared
    this.data = null
  }

  async load() {
    this.data = structuredClone(this.shared.data)
  }

  findByEmail(email) {
    return Object.values(this.data.users).find((user) => user.email === email)
  }

  async mutate(mutator) {
    mutator(this.data)
    this.shared.data = structuredClone(this.data)
  }
}

const createSharedStore = () => ({
  data: {
    users: {},
    challenges: {},
  },
})

test('requires runtime-provided account identity instead of hardcoded defaults', () => {
  assert.throws(() => normalizeTestAccountEmail(''), /TEST_ACCOUNT_EMAIL/)
  assert.throws(() => requireTestAccountName(''), /TEST_ACCOUNT_NAME/)
  assert.equal(normalizeTestAccountEmail(' Demo@Example.Test '), 'demo@example.test')
})

test('creates and reloads a deterministic persistent test account', async () => {
  const shared = createSharedStore()
  const firstStore = new MemoryAuthStore(shared)
  await firstStore.load()

  const result = await provisionTestAccount({
    store: firstStore,
    email: 'demo@example.test',
    name: 'Runtime Demo',
    now: new Date('2026-08-04T12:00:00.000Z'),
  })

  assert.equal(result.created, true)
  assert.equal(result.userId, testAccountUserId('demo@example.test'))

  const verificationStore = new MemoryAuthStore(shared)
  const user = await verifyProvisionedTestAccount({
    store: verificationStore,
    email: 'demo@example.test',
    expectedUserId: result.userId,
  })

  assert.equal(user.name, 'Runtime Demo')
  assert.deepEqual(user.passkeys, [])
})

test('is idempotent and preserves existing passkeys', async () => {
  const shared = createSharedStore()
  const firstStore = new MemoryAuthStore(shared)
  await firstStore.load()

  const first = await provisionTestAccount({
    store: firstStore,
    email: 'demo@example.test',
    name: 'Initial Name',
    now: new Date('2026-08-04T12:00:00.000Z'),
  })

  shared.data.users[first.userId].passkeys.push({ id: 'credential-1' })

  const secondStore = new MemoryAuthStore(shared)
  await secondStore.load()
  const second = await provisionTestAccount({
    store: secondStore,
    email: 'demo@example.test',
    name: 'Updated Name',
    now: new Date('2026-08-04T13:00:00.000Z'),
  })

  assert.equal(second.created, false)
  assert.equal(shared.data.users[first.userId].name, 'Updated Name')
  assert.deepEqual(shared.data.users[first.userId].passkeys, [{ id: 'credential-1' }])
  assert.equal(shared.data.users[first.userId].createdAt, '2026-08-04T12:00:00.000Z')
})

test('rejects an email already assigned to a non-test account', async () => {
  const shared = createSharedStore()
  shared.data.users['google:existing'] = {
    id: 'google:existing',
    email: 'demo@example.test',
    name: 'Existing User',
    passkeys: [],
  }
  const store = new MemoryAuthStore(shared)
  await store.load()

  await assert.rejects(
    provisionTestAccount({
      store,
      email: 'demo@example.test',
      name: 'Runtime Demo',
    }),
    /non-test account already uses/,
  )
})

test('fails closed when the account cannot be reloaded', async () => {
  const shared = createSharedStore()
  const store = new MemoryAuthStore(shared)

  await assert.rejects(
    verifyProvisionedTestAccount({
      store,
      email: 'missing@example.test',
      expectedUserId: testAccountUserId('missing@example.test'),
    }),
    /persistence verification failed/,
  )
})
