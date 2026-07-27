import { createDatabase, migrateDatabase } from './database.js'

const pool = createDatabase(process.env.DATABASE_URL)
try {
  await migrateDatabase(pool)
  console.log(JSON.stringify({ level: 'info', event: 'database_migrations_complete' }))
} finally {
  await pool.end()
}
