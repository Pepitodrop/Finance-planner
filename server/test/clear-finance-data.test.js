import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { clearFinanceData, CLEAR_FINANCE_DATA_CONFIRMATION } from '../scripts/clear-finance-data.mjs'
import { createDatabase, migrateDatabase } from '../src/database.js'

const databaseUrlFor = (baseUrl, databaseName) => {
  const url = new URL(baseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`

test('finance cleanup preserves authentication/system tables and deletes finance/provider rows', { timeout: 60_000 }, async (t) => {
  const baseUrl = process.env.TEST_DATABASE_URL
  if (!baseUrl) return t.skip('TEST_DATABASE_URL is required for the PostgreSQL integration test.')

  const databaseName = `finance_planner_clear_${process.pid}_${Date.now()}`
  const adminPool = new Pool({ connectionString: databaseUrlFor(baseUrl, 'postgres'), max: 1 })
  const databaseUrl = databaseUrlFor(baseUrl, databaseName)

  try {
    await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`)
    const pool = createDatabase(databaseUrl, { max: 2 })
    await migrateDatabase(pool)
    await pool.query("INSERT INTO auth_store (id, encrypted_payload) VALUES (1, '{}'::jsonb)")
    await pool.query("INSERT INTO user_finance_state (user_id, encrypted_payload, version) VALUES ('test:user', '{}'::jsonb, 1)")
    await pool.query("INSERT INTO user_budget_learning_profiles (user_id, encrypted_payload, version) VALUES ('test:user', '{}'::jsonb, 1)")
    await pool.query("INSERT INTO connector_connections (user_id, provider, encrypted_payload) VALUES ('test:user', 'enablebanking', '{}'::jsonb)")
    await pool.query("INSERT INTO oauth_nonces (nonce_hash, consent_id, user_id, provider, redirect_uri, expires_at) VALUES ('nonce', 'consent', 'test:user', 'enablebanking', 'https://example.test/callback', now() + interval '5 minutes')")
    await pool.query("INSERT INTO webhook_events (provider, event_id, occurred_at) VALUES ('enablebanking', 'event', now())")
    await pool.end()

    const dryRun = await clearFinanceData({ env: { DATABASE_URL: databaseUrl }, dryRun: true })
    assert.equal(dryRun.rowsThatWouldBeDeleted.user_finance_state, 1)
    assert.equal(dryRun.rowsThatWouldBeDeleted.connector_connections, 1)
    assert.ok(dryRun.preserved.includes('auth_store'))

    await assert.rejects(
      clearFinanceData({ env: { DATABASE_URL: databaseUrl } }),
      /Refusing destructive cleanup/,
    )

    const result = await clearFinanceData({
      env: {
        DATABASE_URL: databaseUrl,
        CLEAR_FINANCE_DATA_CONFIRM: CLEAR_FINANCE_DATA_CONFIRMATION,
      },
    })
    assert.equal(result.cleared, true)

    const verification = new Pool({ connectionString: databaseUrl, max: 1 })
    try {
      for (const table of ['user_finance_state', 'user_budget_learning_profiles', 'connector_connections', 'oauth_nonces', 'webhook_events']) {
        const rows = await verification.query(`SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`)
        assert.equal(rows.rows[0].count, 0, `${table} should be empty`)
      }
      const authRows = await verification.query('SELECT count(*)::int AS count FROM auth_store')
      assert.equal(authRows.rows[0].count, 1)
      const migrations = await verification.query('SELECT count(*)::int AS count FROM schema_migrations')
      assert.ok(migrations.rows[0].count > 0)
    } finally {
      await verification.end()
    }
  } finally {
    await adminPool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid <> pg_backend_pid()', [databaseName]).catch(() => {})
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`).catch(() => {})
    await adminPool.end()
  }
})
