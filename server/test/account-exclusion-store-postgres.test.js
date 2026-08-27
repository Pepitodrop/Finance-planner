import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { addAccountExclusionMethods, createDatabase, migrateDatabase } from '../src/database.js'

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
const STABLE_ID_A = 'a'.repeat(64)
const STABLE_ID_B = 'b'.repeat(64)

async function withDatabase(run) {
  const pool = createDatabase(databaseUrl, { max: 2 })
  try {
    await migrateDatabase(pool)
    await pool.query('TRUNCATE connector_connections, connector_account_exclusions, oauth_nonces')
    await run(pool)
  } finally {
    await pool.end()
  }
}

// Real-Postgres exercise of the fix for BLOCKER 1 (2026-08-27, PR #154):
// account exclusions must be durable independently of connector_connections
// (which disconnect/reconnect legitimately replaces/deletes), atomic and
// idempotent (no read-modify-write lost-update race), and user/provider
// isolated. addAccountExclusionMethods() is exported from database.js
// (rather than testing server.js's routes directly) because server.js
// calls server.listen() unconditionally at module load -- it cannot be
// safely imported in a test.
test('account exclusion survives connector_connections being deleted (disconnect) and recreated (reconnect)', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = addAccountExclusionMethods({}, pool)
    const userId = `user-${randomUUID()}`

    await pool.query(`INSERT INTO connector_connections (user_id, provider, encrypted_payload) VALUES ($1,'enablebanking','{}')`, [userId])
    await store.addAccountExclusion(userId, 'enablebanking', STABLE_ID_A, 'Savings account')

    // Disconnect: the whole connector_connections row is deleted.
    await pool.query('DELETE FROM connector_connections WHERE user_id=$1', [userId])
    const afterDisconnect = await store.listAccountExclusions(userId, 'enablebanking')
    assert.deepEqual(afterDisconnect.map((e) => e.stableAccountId), [STABLE_ID_A], 'exclusion must survive the connector row being deleted')

    // Reconnect: a brand-new connector_connections row for the same provider.
    await pool.query(`INSERT INTO connector_connections (user_id, provider, encrypted_payload) VALUES ($1,'enablebanking','{}')`, [userId])
    const afterReconnect = await store.listAccountExclusions(userId, 'enablebanking')
    assert.deepEqual(afterReconnect.map((e) => e.stableAccountId), [STABLE_ID_A], 'exclusion must still apply after reconnecting the same provider')
  })
})

test('addAccountExclusion is atomic and idempotent -- concurrent duplicate inserts never lose the exclusion or error', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = addAccountExclusionMethods({}, pool)
    const userId = `user-${randomUUID()}`

    // Two near-simultaneous "Remove account" clicks on the SAME account --
    // must not race into two rows or a constraint-violation error (the
    // exact concurrency requirement from the live review).
    await Promise.all([
      store.addAccountExclusion(userId, 'enablebanking', STABLE_ID_A, 'A'),
      store.addAccountExclusion(userId, 'enablebanking', STABLE_ID_A, 'A'),
    ])
    const exclusions = await store.listAccountExclusions(userId, 'enablebanking')
    assert.equal(exclusions.length, 1)
  })
})

test('two different accounts excluded concurrently on the same connection never lose either exclusion', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = addAccountExclusionMethods({}, pool)
    const userId = `user-${randomUUID()}`

    await Promise.all([
      store.addAccountExclusion(userId, 'enablebanking', STABLE_ID_A, 'A'),
      store.addAccountExclusion(userId, 'enablebanking', STABLE_ID_B, 'B'),
    ])
    const exclusions = await store.listAccountExclusions(userId, 'enablebanking')
    assert.deepEqual(exclusions.map((e) => e.stableAccountId).sort(), [STABLE_ID_A, STABLE_ID_B])
  })
})

test('removeAccountExclusion (Restore) is idempotent and user/provider isolated', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = addAccountExclusionMethods({}, pool)
    const userA = `user-${randomUUID()}`
    const userB = `user-${randomUUID()}`

    await store.addAccountExclusion(userA, 'enablebanking', STABLE_ID_A, 'A')
    await store.addAccountExclusion(userB, 'enablebanking', STABLE_ID_A, 'Same stable id, different user')

    await store.removeAccountExclusion(userA, 'enablebanking', STABLE_ID_A)
    assert.equal((await store.listAccountExclusions(userA, 'enablebanking')).length, 0)
    assert.equal((await store.listAccountExclusions(userB, 'enablebanking')).length, 1, 'restoring user A must never affect user B')

    // Idempotent: restoring again is a no-op, not an error.
    await store.removeAccountExclusion(userA, 'enablebanking', STABLE_ID_A)
  })
})

test('rejects a malformed stable account id -- an arbitrary client-supplied string can never be persisted as an exclusion key', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = addAccountExclusionMethods({}, pool)
    const userId = `user-${randomUUID()}`
    await assert.rejects(store.addAccountExclusion(userId, 'enablebanking', 'not-a-real-stable-id', 'X'))
    await assert.rejects(store.addAccountExclusion(userId, 'enablebanking', `${STABLE_ID_A}; DROP TABLE connector_account_exclusions;--`, 'X'))
    assert.equal((await store.listAccountExclusions(userId, 'enablebanking')).length, 0)
  })
})

test('account_name is bounded and never a raw account number/IBAN is required to be stored', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = addAccountExclusionMethods({}, pool)
    const userId = `user-${randomUUID()}`
    await store.addAccountExclusion(userId, 'enablebanking', STABLE_ID_A, 'x'.repeat(500))
    const [exclusion] = await store.listAccountExclusions(userId, 'enablebanking')
    assert.ok(exclusion.accountName.length <= 160)
    // No accountName at all is also valid -- the exclusion key itself
    // (stableAccountId) never depends on having a display name.
    await store.addAccountExclusion(userId, 'gocardless', STABLE_ID_B)
    const [noName] = await store.listAccountExclusions(userId, 'gocardless')
    assert.equal(noName.accountName, undefined)
  })
})
