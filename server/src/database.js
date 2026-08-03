import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { EncryptedStore } from './crypto-store.js'
import { PostgresStore } from './postgres-store.js'
import { RetentionManager } from './retention.js'

const { Pool } = pg
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')
const downMigrationsDir = join(migrationsDir, 'down')
const advisoryLockId = 741_926_001
let activeDatabasePool = null

export function getActiveDatabasePool() {
  return activeDatabasePool
}

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

export async function migrateDatabase(pool, dir = migrationsDir) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [advisoryLockId])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => Number(row.version)))
    const files = (await readdir(dir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()
    for (const file of files) {
      const version = Number(file.split('_', 1)[0])
      if (!Number.isSafeInteger(version)) throw new Error(`Invalid migration filename: ${file}`)
      if (applied.has(version)) continue
      await client.query(await readFile(join(dir, file), 'utf8'))
      const recorded = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version])
      if (!recorded.rowCount) throw new Error(`Migration ${file} did not record version ${version}.`)
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockId]).catch(() => {})
    client.release()
  }
}

// Rolls back every applied migration newer than targetVersion, newest first, using the
// matching file in migrations/down/. The complete rollback plan is validated before the
// first destructive statement, so a missing or duplicate down-migration cannot cause a
// partially executed rollback. Each checked-in down-migration is itself transactional.
export async function rollbackDatabase(pool, targetVersion, downDir = downMigrationsDir) {
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 0) throw new Error(`Invalid rollback target version: ${targetVersion}`)
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [advisoryLockId])
    const applied = (await client.query('SELECT version FROM schema_migrations ORDER BY version DESC')).rows.map((row) => Number(row.version))
    const toRollBack = applied.filter((version) => version > targetVersion)
    const downFiles = (await readdir(downDir)).filter((name) => /^\d+_.*\.sql$/.test(name))
    const filesByVersion = new Map()
    for (const file of downFiles) {
      const version = Number(file.split('_', 1)[0])
      if (!Number.isSafeInteger(version)) throw new Error(`Invalid down-migration filename: ${file}`)
      if (filesByVersion.has(version)) throw new Error(`Multiple down-migrations found for version ${version}; refusing rollback.`)
      filesByVersion.set(version, file)
    }
    const rollbackPlan = toRollBack.map((version) => {
      const file = filesByVersion.get(version)
      if (!file) throw new Error(`No down-migration found for version ${version}; refusing rollback before making changes.`)
      return { version, file }
    })
    for (const { version, file } of rollbackPlan) {
      await client.query(await readFile(join(downDir, file), 'utf8'))
      const stillRecorded = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version])
      if (stillRecorded.rowCount) throw new Error(`Down-migration ${file} did not remove version ${version} from schema_migrations.`)
    }
    return toRollBack
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockId]).catch(() => {})
    client.release()
  }
}

function addWebhookEventState(store, pool) {
  if (pool) {
    store.getWebhookEventState = async (provider, eventId, now = new Date()) => {
      const result = await pool.query('SELECT completed_at, lease_until FROM webhook_events WHERE provider=$1 AND event_id=$2', [provider, eventId])
      if (!result.rowCount) return 'missing'
      const row = result.rows[0]
      if (row.completed_at) return 'completed'
      if (row.lease_until && new Date(row.lease_until) > now) return 'processing'
      return 'available'
    }
    return store
  }

  store.getWebhookEventState = async (provider, eventId, now = new Date()) => {
    const event = store.data?.webhookEvents?.[`${provider}:${eventId}`]
    if (!event) return 'missing'
    if (event.completedAt) return 'completed'
    if (event.leaseUntil && new Date(event.leaseUntil) > now) return 'processing'
    return 'available'
  }
  return store
}

export async function createConnectorStore(env = process.env) {
  const driver = String(env.CONNECTOR_STORE_DRIVER || 'file').toLowerCase()
  if (driver === 'file') {
    activeDatabasePool = null
    const store = new EncryptedStore(env.CONNECTOR_STORE_PATH || './data/connectors.enc.json', env.CONNECTOR_MASTER_KEY || '')
    await store.load()
    return { store: addWebhookEventState(store, null), pool: null, retention: null, close: async () => {}, driver }
  }
  if (driver !== 'postgres') throw new Error('CONNECTOR_STORE_DRIVER must be file or postgres.')

  const pool = createDatabase(env.DATABASE_URL)
  let retention = null
  try {
    await migrateDatabase(pool)
    const store = new PostgresStore(pool, env.CONNECTOR_MASTER_KEY || '')
    await store.load()
    retention = new RetentionManager({ pool, env })
    retention.start()
    activeDatabasePool = pool
    return {
      store: addWebhookEventState(store, pool),
      pool,
      retention,
      close: async () => {
        retention?.close()
        if (activeDatabasePool === pool) activeDatabasePool = null
        await pool.end()
      },
      driver,
    }
  } catch (error) {
    retention?.close()
    if (activeDatabasePool === pool) activeDatabasePool = null
    await pool.end().catch(() => {})
    throw error
  }
}
