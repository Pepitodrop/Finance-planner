import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { PostgresStore } from '../src/postgres-store.js'

const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL

async function withDatabase(run) {
  const pool = createDatabase(databaseUrl, { max: 2 })
  try {
    await migrateDatabase(pool)
    await migrateDatabase(pool)
    await pool.query('TRUNCATE connector_connections, oauth_nonces, webhook_events')
    await run(pool)
  } finally {
    await pool.end()
  }
}

test('PostgreSQL migrations are idempotent and recorded', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const versions = await pool.query('SELECT version FROM schema_migrations ORDER BY version')
    assert.deepEqual(versions.rows.map((row) => Number(row.version)), [1])
  })
})

test('PostgresStore preserves encrypted connector and one-time nonce behavior', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = new PostgresStore(pool, 'test-master-key-with-at-least-32-characters')
    const userId = `user-${randomUUID()}`
    const consentId = randomUUID()
    const nonce = randomUUID()
    const redirectUri = 'https://finance.example.test/callback'
    const expiresAt = Date.now() + 60_000

    await store.createConnectionSetup({
      userId,
      provider: 'gocardless',
      consentId,
      nonce,
      redirectUri,
      expiresAt,
      connection: { consentId, redirectUri, accessToken: 'secret-token' },
    })

    const raw = await pool.query('SELECT encrypted_payload::text AS payload FROM connector_connections WHERE user_id=$1', [userId])
    assert.equal(raw.rowCount, 1)
    assert.doesNotMatch(raw.rows[0].payload, /secret-token/)

    assert.equal(await store.activateConnection({
      userId,
      provider: 'gocardless',
      consentId,
      nonce,
      redirectUri,
      now: Date.now(),
      connectedAt: '2026-07-27T20:00:00.000Z',
    }), true)
    assert.equal(await store.activateConnection({
      userId,
      provider: 'gocardless',
      consentId,
      nonce,
      redirectUri,
      now: Date.now(),
      connectedAt: '2026-07-27T20:00:01.000Z',
    }), false)

    const stored = await store.get(userId, 'gocardless')
    assert.equal(stored.accessToken, 'secret-token')
    assert.equal(stored.connectedAt, '2026-07-27T20:00:00.000Z')

    await store.remove(userId, 'gocardless')
    assert.equal(await store.get(userId, 'gocardless'), null)
  })
})

test('PostgresStore enforces webhook leases and completion', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = new PostgresStore(pool, 'test-master-key-with-at-least-32-characters')
    const input = {
      provider: 'gocardless',
      eventId: randomUUID(),
      occurredAt: '2026-07-27T20:00:00.000Z',
      leaseUntil: '2026-07-27T20:05:00.000Z',
      now: '2026-07-27T20:00:01.000Z',
    }
    const leaseToken = await store.claimWebhookEvent(input)
    assert.ok(leaseToken)
    assert.equal(await store.claimWebhookEvent(input), undefined)
    assert.equal(await store.completeWebhookEvent({ ...input, leaseToken, completedAt: '2026-07-27T20:01:00.000Z' }), true)
    assert.equal(await store.claimWebhookEvent({ ...input, now: '2026-07-27T20:06:00.000Z' }), undefined)
  })
})
