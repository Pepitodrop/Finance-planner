import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'

export const CLEAR_FINANCE_DATA_CONFIRMATION = 'DELETE_ALL_FINANCE_DATA_KEEP_AUTH'

const FINANCE_TABLES = [
  'connector_connections',
  'oauth_nonces',
  'webhook_events',
  'user_budget_learning_profiles',
  'user_finance_state',
]

function required(env, name) {
  const value = String(env[name] || '').trim()
  if (!value) throw new Error(`${name} is required.`)
  return value
}

export async function clearFinanceData({ env = process.env, dryRun = false } = {}) {
  const databaseUrl = required(env, 'DATABASE_URL')
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    const existing = await pool.query(
      `SELECT tablename
         FROM pg_tables
        WHERE schemaname='public'
          AND tablename = ANY($1::text[])
        ORDER BY tablename`,
      [FINANCE_TABLES],
    )
    const tables = existing.rows.map((row) => row.tablename)
    const counts = {}
    for (const table of tables) {
      const result = await pool.query(`SELECT count(*)::int AS count FROM "${table}"`)
      counts[table] = Number(result.rows[0].count)
    }

    if (dryRun) {
      return {
        dryRun: true,
        tables,
        rowsThatWouldBeDeleted: counts,
        preserved: ['auth_store', 'user_session_revocations', 'request_rate_limits', 'schema_migrations'],
      }
    }

    if (env.CLEAR_FINANCE_DATA_CONFIRM !== CLEAR_FINANCE_DATA_CONFIRMATION) {
      throw new Error(`Refusing destructive cleanup. Set CLEAR_FINANCE_DATA_CONFIRM=${CLEAR_FINANCE_DATA_CONFIRMATION}.`)
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const table of tables) await client.query(`DELETE FROM "${table}"`)
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }

    const auth = tables.includes('auth_store') ? 'unexpected' : 'preserved'
    return {
      cleared: true,
      deletedRows: counts,
      authentication: auth,
      note: 'Authentication identities/passkeys remain; only financial/provider state is deleted.',
    }
  } finally {
    await pool.end()
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isEntrypoint) {
  clearFinanceData({ dryRun: process.argv.includes('--dry-run') })
    .then((summary) => console.log(JSON.stringify(summary, null, 2)))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
}
