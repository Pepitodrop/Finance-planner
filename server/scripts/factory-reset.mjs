import { rm } from 'node:fs/promises'
import { createDatabase, migrateDatabase } from '../src/database.js'

export const REQUIRED_CONFIRMATION = 'DELETE_ALL_FINANCE_PLANNER_DATA'

const env = process.env
const confirmation = String(env.FACTORY_RESET_CONFIRM || '').trim()

if (confirmation !== REQUIRED_CONFIRMATION) {
  throw new Error(`Refusing factory reset. Set FACTORY_RESET_CONFIRM=${REQUIRED_CONFIRMATION}.`)
}

if (String(env.AUTH_MODE || '').trim().toLowerCase() === 'local') {
  throw new Error('Factory reset is unavailable while AUTH_MODE=local because local auth automatically recreates its configured user on restart.')
}

const pool = createDatabase(env.DATABASE_URL)
await migrateDatabase(pool)

const applicationTables = [
  'webhook_events',
  'oauth_nonces',
  'connector_connections',
  'user_budget_learning_profiles',
  'user_finance_state',
  'user_session_revocations',
  'request_rate_limits',
  'auth_store',
]

try {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const deleted = {}
    for (const table of applicationTables) {
      const result = await client.query(`DELETE FROM ${table}`)
      deleted[table] = result.rowCount || 0
    }

    const verification = await client.query(`SELECT
      (SELECT count(*)::int FROM webhook_events) AS webhook_events,
      (SELECT count(*)::int FROM oauth_nonces) AS oauth_nonces,
      (SELECT count(*)::int FROM connector_connections) AS connector_connections,
      (SELECT count(*)::int FROM user_budget_learning_profiles) AS user_budget_learning_profiles,
      (SELECT count(*)::int FROM user_finance_state) AS user_finance_state,
      (SELECT count(*)::int FROM user_session_revocations) AS user_session_revocations,
      (SELECT count(*)::int FROM request_rate_limits) AS request_rate_limits,
      (SELECT count(*)::int FROM auth_store) AS auth_store,
      (SELECT count(*)::int FROM schema_migrations) AS schema_migrations`)

    const remaining = verification.rows[0]
    const residualApplicationRows = applicationTables.some((table) => Number(remaining[table]) !== 0)
    if (residualApplicationRows) throw new Error('Factory reset verification found residual application data.')
    if (Number(remaining.schema_migrations) < 1) throw new Error('Factory reset unexpectedly removed the schema migration ledger.')

    await client.query('COMMIT')

    const legacyFiles = [
      env.AUTH_STORE_PATH || './data/auth.enc.json',
      env.CONNECTOR_STORE_PATH || './data/connectors.enc.json',
    ]
    const removedLegacyFiles = []
    for (const path of legacyFiles) {
      await rm(path, { force: true })
      removedLegacyFiles.push(path)
    }

    console.log(JSON.stringify({
      status: 'ok',
      factoryReset: true,
      verifiedEmpty: true,
      usersPreserved: 0,
      providerRevocationAttempted: false,
      deleted,
      remaining: {
        webhook_events: 0,
        oauth_nonces: 0,
        connector_connections: 0,
        user_budget_learning_profiles: 0,
        user_finance_state: 0,
        user_session_revocations: 0,
        request_rate_limits: 0,
        auth_store: 0,
      },
      schemaMigrationsPreserved: Number(remaining.schema_migrations),
      removedLegacyFiles,
      connectorRestartRequired: true,
      browserSiteDataMustBeCleared: true,
      note: 'All Finance Planner user/application data in PostgreSQL is empty. Restart the connector so its in-memory auth store is discarded. Clear Finance Planner site data in each browser to remove local encrypted vaults/cookies. External provider sessions or consents are not contacted by this command.',
    }, null, 2))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
