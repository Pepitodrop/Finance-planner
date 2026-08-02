import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { decryptCloudPayload, encryptCloudPayload } from '../src/user-state-store.js'
import { buildDemoPayload, REQUIRED_CONFIRMATION, resetAndSeed } from '../scripts/reset-and-seed-demo.mjs'

const databaseUrlFor = (baseUrl, databaseName) => {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`

test('database reset demo seed can be validated without a database', async () => {
  const summary = await resetAndSeed({
    dryRun: true,
    env: { DEMO_USER_EMAIL: 'qa@example.test', DEMO_USER_NAME: 'QA Demo' },
    referenceDate: new Date('2026-08-02T12:00:00Z'),
  })
  assert.equal(summary.dryRun, true)
  assert.equal(summary.email, 'qa@example.test')
  assert.equal(summary.accounts, 6)
  assert.ok(summary.transactions >= 300)
  assert.equal(summary.goals, 5)
})

test('full reset backs up, restores, truncates and seeds encrypted demo data', { timeout: 120_000 }, async (t) => {
  const baseUrl = process.env.TEST_DATABASE_URL
  if (!baseUrl) return t.skip('TEST_DATABASE_URL is required for the PostgreSQL integration test.')

  const databaseName = `finance_planner_reset_${process.pid}_${Date.now()}`
  const adminPool = new Pool({ connectionString: databaseUrlFor(baseUrl, 'postgres'), max: 1 })
  const databaseUrl = databaseUrlFor(baseUrl, databaseName)
  const workdir = await mkdtemp(join(tmpdir(), 'finance-planner-reset-'))
  const backupPath = join(workdir, 'before-reset.dump')
  const connectorKey = 'integration-connector-master-key-with-more-than-32-characters'
  const authKey = 'integration-auth-master-key-with-more-than-32-characters'

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
    const pool = createDatabase(databaseUrl, { max: 2 })
    await migrateDatabase(pool)

    const oldPayload = buildDemoPayload(new Date('2025-01-01T00:00:00Z'))
    await pool.query('INSERT INTO user_finance_state (user_id, encrypted_payload, version) VALUES ($1,$2,7)', ['old-user', encryptCloudPayload(oldPayload, connectorKey, 'old-user')])
    const oldAuth = new AuthStore(join(workdir, 'unused.enc.json'), authKey, pool)
    oldAuth.data = { users: { 'old-user': { id: 'old-user', email: 'old@example.test', name: 'Old User', passkeys: [], createdAt: '2025-01-01T00:00:00Z', updatedAt: '2025-01-01T00:00:00Z' } }, challenges: {} }
    await oldAuth.persist()
    await pool.end()

    const summary = await resetAndSeed({
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        CONNECTOR_MASTER_KEY: connectorKey,
        AUTH_MASTER_KEY: authKey,
        RESET_CONFIRM: REQUIRED_CONFIRMATION,
        RESET_BACKUP_PATH: backupPath,
        DEMO_USER_EMAIL: 'owner@example.test',
        DEMO_USER_NAME: 'Owner Demo',
      },
      referenceDate: new Date('2026-08-02T12:00:00Z'),
    })

    assert.equal(summary.reset, true)
    assert.equal(summary.seededUser.email, 'owner@example.test')
    assert.ok(summary.transactions >= 300)
    assert.ok((await stat(backupPath)).size > 0)

    const verificationPool = new Pool({ connectionString: databaseUrl, max: 2 })
    try {
      const migrations = await verificationPool.query('SELECT count(*)::int AS count FROM schema_migrations')
      assert.ok(migrations.rows[0].count >= 1)
      const financeRows = await verificationPool.query('SELECT user_id, encrypted_payload, version FROM user_finance_state')
      assert.equal(financeRows.rowCount, 1)
      assert.equal(financeRows.rows[0].user_id, 'demo-user')
      assert.equal(Number(financeRows.rows[0].version), 1)
      const payload = decryptCloudPayload(financeRows.rows[0].encrypted_payload, connectorKey, 'demo-user')
      assert.equal(payload.state.accounts.length, 6)
      assert.ok(payload.state.transactions.length >= 300)
      assert.equal(payload.state.goals.length, 5)
      assert.equal(payload.secureData.recurringAnalysis.automatic, true)

      const authStore = new AuthStore(join(workdir, 'unused-verification.enc.json'), authKey, verificationPool)
      await authStore.load()
      assert.deepEqual(Object.keys(authStore.data.users), ['demo-user'])
      assert.equal(authStore.data.users['demo-user'].email, 'owner@example.test')
    } finally {
      await verificationPool.end()
    }
  } finally {
    await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [databaseName]).catch(() => {})
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {})
    await adminPool.end()
    await rm(workdir, { recursive: true, force: true })
  }
})
