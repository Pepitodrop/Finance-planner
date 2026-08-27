import assert from 'node:assert/strict'
import test from 'node:test'
import { ACCOUNT_DELETE_CONFIRMATION, deleteAccountData, validateAccountDeletionInput } from '../src/account-deletion.js'

test('requires an exact, explicit deletion confirmation', () => {
  assert.deepEqual(validateAccountDeletionInput({ confirmation: ACCOUNT_DELETE_CONFIRMATION }), { confirmation: ACCOUNT_DELETE_CONFIRMATION })
  assert.throws(() => validateAccountDeletionInput({ confirmation: 'delete' }), (error) => error.code === 'account_deletion_confirmation_required')
  assert.throws(() => validateAccountDeletionInput({ confirmation: ACCOUNT_DELETE_CONFIRMATION, userId: 'attacker-controlled' }), (error) => error.code === 'invalid_account_deletion')
})

test('revokes sessions before deleting all PostgreSQL user records transactionally', async () => {
  const events = []
  const client = {
    async query(sql, values = []) {
      events.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: 0 }
      return { rowCount: 1 }
    },
    release() { events.push({ sql: 'RELEASE', values: [] }) },
  }
  const persistence = { pool: { connect: async () => client } }
  const revocations = { revoke: async (userId) => { events.push({ sql: 'REVOKE', values: [userId] }); return '2026-08-01T12:00:00.000Z' } }

  const result = await deleteAccountData({
    userId: 'user-1',
    persistence,
    store: {},
    sessionRevocations: revocations,
    now: new Date('2026-08-01T12:00:00Z'),
  })

  assert.equal(events[0].sql, 'REVOKE')
  assert.equal(events[1].sql, 'BEGIN')
  assert.deepEqual(events.filter((entry) => entry.sql.startsWith('DELETE FROM')).map((entry) => entry.sql), [
    'DELETE FROM connector_connections WHERE user_id=$1',
    // connector_account_exclusions (2026-08-27, PR #154): durable,
    // independent of connector_connections -- see database.js's
    // addAccountExclusionMethods() doc comment for why disconnect/reconnect
    // must never lose it, but a full account deletion must still remove it.
    'DELETE FROM connector_account_exclusions WHERE user_id=$1',
    'DELETE FROM oauth_nonces WHERE user_id=$1',
    'DELETE FROM user_finance_state WHERE user_id=$1',
    'DELETE FROM user_budget_learning_profiles WHERE user_id=$1',
  ])
  assert.equal(events.at(-2).sql, 'COMMIT')
  assert.equal(events.at(-1).sql, 'RELEASE')
  assert.deepEqual(result.deleted, { connectorConnections: 1, accountExclusions: 1, oauthNonces: 1, financeState: 1, learningProfiles: 1 })
})

test('rolls back a failed PostgreSQL deletion after sessions are revoked', async () => {
  const events = []
  const client = {
    async query(sql) {
      events.push(sql)
      if (sql.startsWith('DELETE FROM oauth_nonces')) throw new Error('database failure')
      return { rowCount: 1 }
    },
    release() { events.push('RELEASE') },
  }
  await assert.rejects(() => deleteAccountData({
    userId: 'user-1',
    persistence: { pool: { connect: async () => client } },
    store: {},
    sessionRevocations: { revoke: async () => '2026-08-01T12:00:00.000Z' },
  }), /database failure/)
  assert.ok(events.includes('ROLLBACK'))
  assert.equal(events.at(-1), 'RELEASE')
})

test('removes every file-backed connector and OAuth nonce without a provider whitelist', async () => {
  const calls = []
  const result = await deleteAccountData({
    userId: 'local-user',
    persistence: { pool: null },
    store: {
      removeUser: async (userId) => {
        calls.push(userId)
        return { connectorConnections: 4, accountExclusions: 3, oauthNonces: 2 }
      },
    },
    sessionRevocations: { revoke: async () => '2026-08-01T12:00:00.000Z' },
  })
  assert.deepEqual(calls, ['local-user'])
  assert.equal(result.persistence, 'file')
  assert.deepEqual(result.deleted, { connectorConnections: 4, accountExclusions: 3, oauthNonces: 2, financeState: 0, learningProfiles: 0 })
})

test('fails closed when a file-backed store cannot delete all provider data', async () => {
  await assert.rejects(
    deleteAccountData({
      userId: 'local-user',
      persistence: { pool: null },
      store: { remove: async () => {} },
      sessionRevocations: { revoke: async () => '2026-08-01T12:00:00.000Z' },
    }),
    /complete user deletion/,
  )
})
