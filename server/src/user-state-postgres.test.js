import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createDatabase, migrateDatabase } from './database.js'
import { PostgresUserStateStore, StateVersionConflictError, validateCloudPayload } from './user-state-store.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const secret = 'postgres-state-test-master-key-with-enough-length-123'

const payload = {
  state: {
    accounts: [{ id: 'account-1', name: 'Girokonto', type: 'checking', balanceCents: 123400, currency: 'EUR' }],
    transactions: [{ id: 'transaction-1', accountId: 'account-1', description: 'Postgres Secret Merchant', category: 'Test', type: 'expense', amountCents: 1000, date: '2026-07-31' }],
    goals: [{ id: 'goal-1', name: 'Cloud Test', targetCents: 500000, currentCents: 1000, targetDate: '2027-01-01' }],
  },
  secureData: { 'assistant-memory-v1': [{ mode: 'question', question: 'test', answer: 'test', createdAt: '2026-07-31T10:00:00.000Z' }] },
}

test('PostgreSQL stores and versions an encrypted per-user finance vault', { skip: !databaseUrl }, async () => {
  const pool = createDatabase(databaseUrl, { max: 2 })
  const userId = `test:${randomUUID()}`
  try {
    await migrateDatabase(pool)
    const store = new PostgresUserStateStore(pool, secret)

    const created = await store.save(userId, payload, 0)
    assert.equal(created.version, 1)
    // save() round-trips through validateCloudPayload(), which normalizes
    // the stored shape (e.g. defaulting an absent `subscriptions` to `[]`
    // as of 2026-08-26) -- compare against that same normalization rather
    // than the raw input literal.
    assert.deepEqual((await store.get(userId)).payload, validateCloudPayload(payload))

    await assert.rejects(() => store.save(userId, payload, 0), StateVersionConflictError)
    const updated = await store.save(userId, { ...payload, state: { ...payload.state, goals: [] } }, 1)
    assert.equal(updated.version, 2)

    const raw = await pool.query('SELECT encrypted_payload::text AS payload FROM user_finance_state WHERE user_id=$1', [userId])
    assert.equal(raw.rowCount, 1)
    assert.equal(raw.rows[0].payload.includes('Postgres Secret Merchant'), false)
    assert.equal(raw.rows[0].payload.includes('Girokonto'), false)
  } finally {
    await pool.query('DELETE FROM user_finance_state WHERE user_id=$1', [userId]).catch(() => {})
    await pool.end()
  }
})
