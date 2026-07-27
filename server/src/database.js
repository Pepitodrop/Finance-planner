import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { EncryptedStore } from './crypto-store.js'
import { PostgresStore } from './postgres-store.js'

const { Pool } = pg
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const advisoryLockId = 741_926_001

export function createDatabase(url, options = {}) {
  if (!url) throw new Error('DATABASE_URL is required when CONNECTOR_STORE_DRIVER=postgres.')
  return new Pool({
    connectionString: url,
    max: Number(options.max ?? process.env.DATABASE_POOL_SIZE ?? 10),
    connectionTimeoutMillis: Number(options.connectionTimeoutMillis ?? 5000),
    idleTimeoutMillis: Number(options.idleTimeoutMillis ?? 30_000),
    application_name: 'finance-planner-connector',
  })
}

export async function migrateDatabase(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [advisoryLockId])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => Number(row.version)))
    const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()
    for (const file of files) {
      const version = Number(file.split('_', 1)[0])
      if (!Number.isSafeInteger(version)) throw new Error(`Invalid migration filename: ${file}`)
      if (applied.has(version)) continue
      await client.query(await readFile(join(migrationsDir, file), 'utf8'))
      const recorded = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version])
      if (!recorded.rowCount) throw new Error(`Migration ${file} did not record version ${version}.`)
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockId]).catch(() => {})
    client.release()
  }
}

export async function createConnectorStore(env = process.env) {
  const driver = String(env.CONNECTOR_STORE_DRIVER || 'file').toLowerCase()
  if (driver === 'file') {
    const store = new EncryptedStore(env.CONNECTOR_STORE_PATH || './data/connectors.enc.json', env.CONNECTOR_MASTER_KEY || '')
    await store.load()
    return { store, close: async () => {}, driver }
  }
  if (driver !== 'postgres') throw new Error('CONNECTOR_STORE_DRIVER must be file or postgres.')

  const pool = createDatabase(env.DATABASE_URL)
  try {
    await migrateDatabase(pool)
    const store = new PostgresStore(pool, env.CONNECTOR_MASTER_KEY || '')
    await store.load()
    return { store, close: () => pool.end(), driver }
  } catch (error) {
    await pool.end().catch(() => {})
    throw error
  }
}
