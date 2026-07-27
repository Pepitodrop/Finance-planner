import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export function createDatabase(url) {
  if (!url) throw new Error('DATABASE_URL is required when CONNECTOR_STORE_DRIVER=postgres.')
  return new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_SIZE || 10), connectionTimeoutMillis: 5000 })
}

export async function migrateDatabase(pool) {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [741_926_001])
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version bigint PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((row) => Number(row.version)))
    const files = (await readdir(migrationsDir)).filter((name) => /^\d+_.*\.sql$/.test(name)).sort()
    for (const file of files) {
      const version = Number(file.split('_', 1)[0])
      if (applied.has(version)) continue
      await client.query(await readFile(join(migrationsDir, file), 'utf8'))
      const recorded = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [version])
      if (!recorded.rowCount) throw new Error(`Migration ${file} did not record version ${version}.`)
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [741_926_001]).catch(() => {})
    client.release()
  }
}
