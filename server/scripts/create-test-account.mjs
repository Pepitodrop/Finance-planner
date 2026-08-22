import { AuthStore } from '../src/auth-store.js'
import { createDatabase, migrateDatabase } from '../src/database.js'
import {
  normalizeTestAccountEmail,
  provisionTestAccount,
  requireTestAccountName,
  verifyProvisionedTestAccount,
} from '../src/test-account-provisioning.js'

const env = process.env
const email = normalizeTestAccountEmail(process.argv[2] || env.TEST_ACCOUNT_EMAIL)
const name = requireTestAccountName(env.TEST_ACCOUNT_NAME)
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

  console.log(JSON.stringify({
    status: 'ok',
    created: provisioned.created,
    persisted: true,
    financialDataSeeded: false,
  }, null, 2))
} finally {
  await pool.end()
}
