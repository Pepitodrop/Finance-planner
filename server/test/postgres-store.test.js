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

    const claim = await store.claimPendingConnectionSetup({
      userId,
      provider: 'gocardless',
      consentId,
      nonce,
      redirectUri,
      now: Date.now(),
    })
    assert.equal(claim.status, 'claimed')
    assert.equal(claim.connection?.accessToken, 'secret-token')

    // The nonce is claimed, not deleted -- a second claim attempt while
    // unresolved (completeCallback()/finalizeConnection() have not run yet)
    // must see it as in progress, not as available to re-claim.
    const duplicate = await store.claimPendingConnectionSetup({
      userId,
      provider: 'gocardless',
      consentId,
      nonce,
      redirectUri,
      now: Date.now(),
    })
    assert.equal(duplicate.status, 'in_progress')

    await store.finalizeConnection({
      userId,
      provider: 'gocardless',
      connection: claim.connection,
      connectedAt: '2026-07-27T20:00:00.000Z',
    })

    const stored = await store.get(userId, 'gocardless')
    assert.equal(stored.accessToken, 'secret-token')
    assert.equal(stored.connectedAt, '2026-07-27T20:00:00.000Z')

    // Only releasing the claim (the success path, after finalizeConnection())
    // actually removes the nonce -- matching the original single-use
    // guarantee, just moved to after finalization instead of before the
    // provider network call.
    assert.equal(await store.releasePendingConnectionSetup({ nonce, claimToken: claim.claimToken }), true)
    assert.equal((await store.claimPendingConnectionSetup({ userId, provider: 'gocardless', consentId, nonce, redirectUri, now: Date.now() })).status, 'not_found')

    await store.remove(userId, 'gocardless')
    assert.equal(await store.get(userId, 'gocardless'), null)
  })
})

test('claimPendingConnectionSetup/finalizeConnection: a working connection survives a reconnect attempt whose provider-side exchange never completes', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = new PostgresStore(pool, 'test-master-key-with-at-least-32-characters')
    const userId = `user-${randomUUID()}`
    const consentId = randomUUID()
    const nonce = randomUUID()
    const redirectUri = 'https://finance.example.test/callback'

    await store.set(userId, 'enablebanking', { sessionId: 'still-working-session' })
    await store.createPendingConnectionSetup({
      userId,
      provider: 'enablebanking',
      consentId,
      nonce,
      redirectUri,
      expiresAt: Date.now() + 60_000,
      connection: { consentId, redirectUri, aspspName: 'ING-DiBa' },
    })

    // Simulates the server callback route claiming the nonce successfully,
    // then the provider's completeCallback() (the code-for-session exchange)
    // failing -- finalizeConnection() is deliberately never called, and the
    // claim is released the same way the real failure path does. The nonce
    // is spent (one-shot, matching real OAuth code single-use semantics) but
    // the previously-working connection must be completely untouched.
    const claim = await store.claimPendingConnectionSetup({ userId, provider: 'enablebanking', consentId, nonce, redirectUri, now: Date.now() })
    assert.equal(claim.status, 'claimed', 'the nonce is still valid the first time it is claimed')

    const stillWorking = await store.get(userId, 'enablebanking')
    assert.equal(stillWorking.sessionId, 'still-working-session', 'the old connection must survive a completeCallback() failure')

    await store.releasePendingConnectionSetup({ nonce, claimToken: claim.claimToken })
    const replay = await store.claimPendingConnectionSetup({ userId, provider: 'enablebanking', consentId, nonce, redirectUri, now: Date.now() })
    assert.equal(replay.status, 'not_found', 'the nonce cannot be claimed twice, even after the first claimer never finalized')
  })
})

// The centerpiece regression for the live concurrent-duplicate-callback race
// (2026-08-25, Mock ASPSP run against PR #154): two literally concurrent
// claim attempts for the exact same signed attempt, issued against real
// Postgres via Promise.all (not sequenced by the test), must still resolve
// to exactly one 'claimed' and one 'in_progress' -- the row-level lock taken
// by claimPendingConnectionSetup()'s UPDATE is what enforces this, not
// anything in this test or in JS. This is what makes the fix correct across
// multiple connector processes/instances sharing one Postgres database, not
// just within a single process's event loop.
test('claimPendingConnectionSetup is exactly-once under real concurrent Postgres clients', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const storeA = new PostgresStore(pool, 'test-master-key-with-at-least-32-characters')
    const storeB = new PostgresStore(pool, 'test-master-key-with-at-least-32-characters')
    const userId = `user-${randomUUID()}`
    const consentId = randomUUID()
    const nonce = randomUUID()
    const redirectUri = 'https://finance.example.test/callback'
    const input = { userId, provider: 'enablebanking', consentId, nonce, redirectUri, now: Date.now() }

    await storeA.createPendingConnectionSetup({ ...input, expiresAt: Date.now() + 60_000, connection: { consentId, redirectUri, aspspName: 'ING-DiBa' } })

    const [resultA, resultB] = await Promise.all([
      storeA.claimPendingConnectionSetup(input),
      storeB.claimPendingConnectionSetup(input),
    ])
    const statuses = [resultA.status, resultB.status].sort()
    assert.deepEqual(statuses, ['claimed', 'in_progress'], 'exactly one concurrent claim attempt wins; the other must observe in_progress, never a second claimed result and never not_found')

    const winner = resultA.status === 'claimed' ? resultA : resultB
    assert.equal(winner.connection?.aspspName, 'ING-DiBa')

    // The loser polling again while unresolved still sees in_progress, never
    // a chance to also become 'claimed'.
    assert.equal((await storeA.claimPendingConnectionSetup(input)).status, 'in_progress')

    await storeA.finalizeConnection({ userId, provider: 'enablebanking', connection: winner.connection, connectedAt: '2026-07-27T20:00:00.000Z' })
    await storeA.releasePendingConnectionSetup({ nonce, claimToken: winner.claimToken })

    const stored = await storeA.get(userId, 'enablebanking')
    assert.equal(stored.aspspName, 'ING-DiBa')
    assert.ok(stored.connectedAt)
  })
})

// Found by independent review (2026-08-25): the payload-consistency check
// originally ran AFTER the claim's COMMIT, so a mismatch left claim_token
// set on a row nobody held the token for -- permanently stuck as "claimed"
// (with no way to ever release it) until the retention sweep's natural
// expiry, rather than being rolled back and left genuinely re-claimable.
test('claimPendingConnectionSetup rolls back (does not commit) when the pending payload disagrees with the nonce row, so the nonce is never left stuck as claimed-by-no-one', { skip: !databaseUrl }, async () => {
  await withDatabase(async (pool) => {
    const store = new PostgresStore(pool, 'test-master-key-with-at-least-32-characters')
    const userId = `user-${randomUUID()}`
    const consentId = randomUUID()
    const nonce = randomUUID()
    const redirectUri = 'https://finance.example.test/callback'

    // Deliberately inconsistent: the row's own consent_id/redirect_uri
    // columns (what the claim's WHERE clause matches against) say one
    // thing, but the embedded encrypted payload disagrees -- this would
    // only happen from a caller bug/data corruption, never through normal
    // use, but it's exactly the defensive check the pre-fix
    // consumePendingConnectionSetup() already had (and correctly rolled
    // back on).
    await store.createPendingConnectionSetup({
      userId, provider: 'enablebanking', consentId, nonce, redirectUri,
      expiresAt: Date.now() + 60_000,
      connection: { consentId: 'a-different-consent-id-than-the-row-itself', redirectUri, aspspName: 'ING-DiBa' },
    })

    const result = await store.claimPendingConnectionSetup({ userId, provider: 'enablebanking', consentId, nonce, redirectUri, now: Date.now() })
    assert.equal(result.status, 'not_found')

    const row = await pool.query('SELECT claim_token FROM oauth_nonces WHERE user_id=$1', [userId])
    assert.equal(row.rowCount, 1, 'the row itself must still exist (rolled back, not deleted)')
    assert.equal(row.rows[0].claim_token, null, 'a rolled-back claim attempt must never leave claim_token set on the row -- otherwise nobody holds the token needed to ever release it')
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