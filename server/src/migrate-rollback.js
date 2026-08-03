import { createDatabase, rollbackDatabase } from './database.js'

const targetVersion = Number(process.argv[2])
if (!Number.isSafeInteger(targetVersion) || targetVersion < 0) {
  console.error('Usage: node src/migrate-rollback.js <target-version>')
  console.error('Rolls back every applied migration newer than <target-version>. Pass 0 to roll back everything.')
  process.exit(1)
}

const pool = createDatabase(process.env.DATABASE_URL)
try {
  const rolledBack = await rollbackDatabase(pool, targetVersion)
  console.log(JSON.stringify({ level: 'info', event: 'database_rollback_complete', targetVersion, rolledBack }))
} finally {
  await pool.end()
}
