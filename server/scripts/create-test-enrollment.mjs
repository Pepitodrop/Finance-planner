import { createHash } from 'node:crypto'
import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import { encryptCloudPayload } from '../src/user-state-store.js'
import { buildDemoPayload } from './reset-and-seed-demo.mjs'

function requiredEmail(value) {
  const email = String(value || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid TEST_ACCOUNT_EMAIL is required.')
  }
  return email
}

const env = process.env
const email = requiredEmail(process.argv[2] || env.TEST_ACCOUNT_EMAIL)
const name = String(env.TEST_ACCOUNT_NAME || 'Finance Planner Test').trim()
const seedDemoData = String(env.SEED_DEMO_DATA || '').toLowerCase() === 'true'
const pool = createDatabase(env.DATABASE_URL)

await migrateDatabase(pool)

try {
  const store = new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )

  await store.load()

  const userId = `test:${createHash('sha256').update(email).digest('hex').slice(0, 24)}`
  const now = new Date().toISOString()

  await store.mutate((data) => {
    const existing = data.users[userId] || store.findByEmail(email)
    const user = existing || {
      id: userId,
      email,
      name,
      passkeys: [],
      createdAt: now,
    }

    user.id = userId
    user.email = email
    user.name = name
    user.passkeys ||= []
    user.updatedAt = now
    data.users[userId] = user
  })

  const verificationStore = new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )
  await verificationStore.load()

  const verifiedUser = verificationStore.findByEmail(email)
  if (!verifiedUser || verifiedUser.id !== userId) {
    throw new Error(`Test account persistence verification failed for ${email}.`)
  }

  let seedSummary = null
  if (seedDemoData) {
    const payload = buildDemoPayload(new Date())
    const encryptedPayload = encryptCloudPayload(
      payload,
      env.CONNECTOR_MASTER_KEY,
      userId,
    )

    const result = await pool.query(
      `INSERT INTO user_finance_state
         (user_id, encrypted_payload, version, updated_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (user_id)
       DO UPDATE SET
         encrypted_payload = EXCLUDED.encrypted_payload,
         version = user_finance_state.version + 1,
         updated_at = now()
       RETURNING version, updated_at`,
      [userId, encryptedPayload],
    )

    seedSummary = {
      version: Number(result.rows[0].version),
      updatedAt: result.rows[0].updated_at,
      accounts: payload.state.accounts.length,
      transactions: payload.state.transactions.length,
      goals: payload.state.goals.length,
    }
  }

  console.log(JSON.stringify({
    created: true,
    persisted: true,
    email,
    userId,
    name,
    passwordLoginConfigured: Boolean(env.TEST_ACCOUNT_PASSWORD_HASH),
    demoDataSeeded: seedDemoData,
    seed: seedSummary,
    note: 'This command creates a persistent password-capable test account. It does not create a passkey enrollment token.',
  }, null, 2))
} finally {
  await pool.end()
}
