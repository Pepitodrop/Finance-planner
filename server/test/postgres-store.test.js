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
    const recorded = versions.rows.map((row) => Number(row.version))
    assert.ok(recorded.includes(1), 'initial connector-store migration must be recorded')
    assert.ok(recorded.includes(5), 'distributed rate-limit migration must be recorded')
    assert.equal(new Set(recorded).size, recorded.length, 'migration versions must be unique')
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

    // A previously-working connection (reconnect case) must survive an
    // in-flight, not-yet-activated setup for the same user/provider.
    await store.set(userId, 'gocardless', { accessToken: 'previously-working-token' })

    await store.createPendingConnectionSetup({
      userId,
      provider: 'gocardless',
      consentId,
      nonce,
      redirectUri,
      expiresAt,
      connection: { consentId, redirectUri, accessToken: 'secret-token' },
    })

    const pendingRaw = await pool.query('SELECT pending_payload::text AS payload FROM oauth_nonces WHERE user_id=$1', [userId])
    assert.equal(pendingRaw.rowCount, 1)
    assert.doesNotMatch(pendingRaw.rows[0].payload, /secret-token/, 'the pending payload itself must be encrypted at rest')

    const stillWorking = await store.get(userId, 'gocardless')
    assert.equal(stillWorking.accessToken, 'previously-working-token', 'the working connection must not be overwritten before activation')

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