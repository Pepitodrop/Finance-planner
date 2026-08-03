import { createHash, randomBytes } from 'node:crypto'
import { AuthStore } from './auth-store.js'
import { createDatabase, migrateDatabase } from './database.js'

export const enrollmentKey = (token) => `test-enrollment:${createHash('sha256').update(String(token), 'utf8').digest('hex')}`

export async function createEnrollmentStore(env = process.env) {
  const pool = createDatabase(env.DATABASE_URL)
  await migrateDatabase(pool)
  const store = new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )
  await store.load()
  return { pool, store }
}

export async function createTestEnrollment({ env = process.env, email, name = 'Finance Planner Test', ttlMinutes = 15 }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('A valid test-account email is required.')
  const normalizedEmail = email.toLowerCase()
  const { pool, store } = await createEnrollmentStore(env)
  try {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + Math.max(5, Math.min(60, Number(ttlMinutes) || 15)) * 60_000
    let user = store.findByEmail(normalizedEmail)
    await store.mutate((data) => {
      user ||= {
        id: `test:${createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 24)}`,
        email: normalizedEmail,
        name,
        passkeys: [],
        createdAt: new Date().toISOString(),
      }
      user.name = name
      user.updatedAt = new Date().toISOString()
      data.users[user.id] = user
      for (const key of Object.keys(data.challenges)) {
        if (key.startsWith('test-enrollment:') && data.challenges[key]?.userId === user.id) delete data.challenges[key]
      }
      data.challenges[enrollmentKey(token)] = { userId: user.id, expiresAt }
    })
    return { token, userId: user.id, email: normalizedEmail, expiresAt }
  } finally {
    await pool.end()
  }
}
