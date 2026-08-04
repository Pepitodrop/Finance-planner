import { readFile } from 'node:fs/promises'
import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import {
  encryptCloudPayload,
  validateCloudPayload,
} from '../src/user-state-store.js'
import {
  normalizeTestAccountEmail,
  provisionTestAccount,
  requireTestAccountName,
  verifyProvisionedTestAccount,
} from '../src/test-account-provisioning.js'

const env = process.env
const email = normalizeTestAccountEmail(process.argv[2] || env.TEST_ACCOUNT_EMAIL)
const name = requireTestAccountName(env.TEST_ACCOUNT_NAME)
const seedFile = String(env.TEST_ACCOUNT_SEED_FILE || '').trim()
const pool = createDatabase(env.DATABASE_URL)

await migrateDatabase(pool)

try {
  const createStore = () => new AuthStore(
    env.AUTH_STORE_PATH || './data/auth.enc.json',
    env.AUTH_MASTER_KEY || env.CONNECTOR_MASTER_KEY || '',
    pool,
    env.AUTH_MASTER_KEY ? env.CONNECTOR_MASTER_KEY || '' : '',
  )

  const store = createStore()
  await store.load()

  const provisioned = await provisionTestAccount({ store, email, name })
  await verifyProvisionedTestAccount({
    store: createStore(),
    email,
    expectedUserId: provisioned.userId,
  })

  let seedSummary = null
  if (seedFile) {
    const payload = JSON.parse(await readFile(seedFile, 'utf8'))
    validateCloudPayload(payload)

    const encryptedPayload = encryptCloudPayload(
      payload,
      env.CONNECTOR_MASTER_KEY,
      provisioned.userId,
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
       RETURNING version`,
      [provisioned.userId, encryptedPayload],
    )

    seedSummary = {
      version: Number(result.rows[0].version),
      accounts: payload.state.accounts.length,
      transactions: payload.state.transactions.length,
      goals: payload.state.goals.length,
    }
  }

  console.log(JSON.stringify({
    status: 'ok',
    created: provisioned.created,
    persisted: true,
    seedApplied: Boolean(seedFile),
    seed: seedSummary,
  }, null, 2))
} finally {
  await pool.end()
}
